import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, In, IsNull } from "typeorm";
import { CustomerSegment } from "../clients/entities";
import { MenuCategory, MenuItem } from "../menu/entities";
import { CoffeeShop } from "../database/entities";
import { CreatePromotionDto, PromotionAdvancedRuleDto, PromotionCustomerConditionDto, PromotionRuleGroupDto, PromotionTargetDto, UpdatePromotionDto } from "./dto/promotion.dto";
import { AdvancedPromotionType, Promotion, PromotionAdvancedRule, PromotionCoupon, PromotionCustomerCondition, PromotionCustomerConditionOperator, PromotionCustomerConditionType, PromotionQuantityTier, PromotionRewardType, PromotionRuleGroup, PromotionRuleGroupRole, PromotionRuleTarget, PromotionScheduleWindow, PromotionTarget } from "./entities";
import { promotionStatus } from "./promotion-pricing.util";
import { isValidTimeZone, PROMOTION_WEEKDAYS } from "./promotion-schedule.util";

@Injectable()
export class PromotionsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string, timezone?: string) {
    const tenantTimezone = await this.tenantTimezone(coffeeShopId, timezone);
    const promotions = await this.dataSource.getRepository(Promotion).find({ where: { coffeeShopId }, relations: { targets: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true }, customerConditions: true }, order: { updatedAt: "DESC" }, withDeleted: true });
    return this.projectMany(coffeeShopId, promotions, tenantTimezone);
  }

  async get(coffeeShopId: string, id: string, timezone?: string) {
    const tenantTimezone = await this.tenantTimezone(coffeeShopId, timezone);
    const promotion = await this.dataSource.getRepository(Promotion).findOne({ where: { id, coffeeShopId }, relations: { targets: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true }, customerConditions: true }, withDeleted: true });
    if (!promotion) throw new NotFoundException("Promotion not found");
    return (await this.projectMany(coffeeShopId, [promotion], tenantTimezone))[0];
  }

  async create(coffeeShopId: string, actorUserId: string, input: CreatePromotionDto, timezone?: string) {
    const tenantTimezone = await this.tenantTimezone(coffeeShopId, timezone);
    this.validateFields(input.rewardType, input.rewardValue, input.startAt, input.endAt, input.name);
    this.validateAdvancedRule(input.advancedRule, input.entireOrder, input.targets, input.rewardType, input.minimumSubtotalToman, input.maxDiscountToman);
    this.validateCustomerConditions(input.customerConditions ?? []);
    this.validateSchedule(input.schedule, tenantTimezone);
    this.validateOrderFields(input.entireOrder, input.rewardType, input.targets, input.maxDiscountToman, Boolean(input.couponCode), Boolean(input.advancedRule));
    this.validateCouponDates(input.couponStartsAt, input.couponExpiresAt);
    const id = await this.dataSource.transaction(async (manager) => {
      if (input.advancedRule) await this.validateAdvancedTargets(manager, coffeeShopId, input.advancedRule);
      else if (!input.entireOrder) await this.validateTargets(manager, coffeeShopId, input.targets);
      await this.validateCustomerSegments(manager, coffeeShopId, input.customerConditions ?? []);
      if (input.couponCode && await manager.findOneBy(PromotionCoupon, { coffeeShopId, normalizedCode: input.couponCode.trim().toUpperCase() })) throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." });
      const promotion = await manager.save(Promotion, manager.create(Promotion, {
        coffeeShopId, name: input.name.trim(), description: input.description?.trim() || null,
        isActive: input.isActive, startAt: input.startAt ? new Date(input.startAt) : null, endAt: input.endAt ? new Date(input.endAt) : null,
        priority: input.priority, rewardType: input.rewardType, rewardValue: String(input.rewardValue), createdByUserId: actorUserId,
        entireOrder: input.entireOrder, minimumSubtotalToman: input.minimumSubtotalToman == null ? null : String(input.minimumSubtotalToman),
        maxDiscountToman: input.maxDiscountToman == null ? null : String(input.maxDiscountToman),
      }));
      if (!input.advancedRule && input.targets.length) await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
        coffeeShopId, promotionId: promotion.id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
      })));
      if (input.advancedRule) await this.saveAdvancedRule(manager, coffeeShopId, promotion.id, input.advancedRule);
      if (input.customerConditions?.length) await this.saveCustomerConditions(manager, coffeeShopId, promotion.id, input.customerConditions);
      if (input.schedule) await this.saveSchedule(manager, coffeeShopId, promotion.id, input.schedule);
      if (input.couponCode) await manager.save(PromotionCoupon, manager.create(PromotionCoupon, {
        coffeeShopId, promotionId: promotion.id, code: input.couponCode.trim().toUpperCase(), normalizedCode: input.couponCode.trim().toUpperCase(),
        isActive: input.couponActive ?? true, startsAt: input.couponStartsAt ? new Date(input.couponStartsAt) : null,
        expiresAt: input.couponExpiresAt ? new Date(input.couponExpiresAt) : null,
        totalUsageLimit: input.totalUsageLimit ?? null, perCustomerUsageLimit: input.perCustomerUsageLimit ?? null,
      }));
      return promotion.id;
    }).catch((error: unknown) => { if ((error as { driverError?: { constraint?: string } }).driverError?.constraint === "uq_promotion_coupons_tenant_code") throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." }); throw error; });
    return this.get(coffeeShopId, id, tenantTimezone);
  }

  async update(coffeeShopId: string, id: string, input: UpdatePromotionDto, timezone?: string) {
    const tenantTimezone = await this.tenantTimezone(coffeeShopId, timezone);
    await this.dataSource.transaction(async (manager) => {
      const promotion = await manager.findOne(Promotion, { where: { id, coffeeShopId }, relations: { targets: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true }, customerConditions: true } });
      if (!promotion) throw new NotFoundException("Promotion not found");
      const rewardType = input.rewardType ?? promotion.rewardType;
      const rewardValue = input.rewardValue ?? Number(promotion.rewardValue);
      const name = input.name ?? promotion.name;
      const startAt = input.startAt === undefined ? promotion.startAt?.toISOString() : input.startAt ?? undefined;
      const endAt = input.endAt === undefined ? promotion.endAt?.toISOString() : input.endAt ?? undefined;
      this.validateFields(rewardType, rewardValue, startAt, endAt, name);
      if (input.schedule !== undefined) this.validateSchedule(input.schedule, tenantTimezone);
      const entireOrder = input.entireOrder ?? promotion.entireOrder;
      const targets = input.targets ?? promotion.targets;
      const advancedRule = input.advancedRule === undefined ? this.ruleDto(promotion.advancedRule) : input.advancedRule ?? undefined;
      if (input.customerConditions !== undefined) this.validateCustomerConditions(input.customerConditions);
      this.validateAdvancedRule(advancedRule, entireOrder, targets, rewardType, input.minimumSubtotalToman === undefined ? (promotion.minimumSubtotalToman ? Number(promotion.minimumSubtotalToman) : null) : input.minimumSubtotalToman, input.maxDiscountToman === undefined ? (promotion.maxDiscountToman ? Number(promotion.maxDiscountToman) : null) : input.maxDiscountToman);
      const currentCoupon = await manager.findOneBy(PromotionCoupon, { coffeeShopId, promotionId: id });
      this.validateOrderFields(entireOrder, rewardType, targets, input.maxDiscountToman === undefined ? (promotion.maxDiscountToman ? Number(promotion.maxDiscountToman) : null) : input.maxDiscountToman, Boolean(currentCoupon || input.couponCode), Boolean(advancedRule));
      this.validateCouponDates(input.couponStartsAt === undefined ? currentCoupon?.startsAt?.toISOString() : input.couponStartsAt, input.couponExpiresAt === undefined ? currentCoupon?.expiresAt?.toISOString() : input.couponExpiresAt);
      if (advancedRule) await this.validateAdvancedTargets(manager, coffeeShopId, advancedRule);
      else if (input.targets && !entireOrder) await this.validateTargets(manager, coffeeShopId, input.targets);
      if (input.customerConditions !== undefined) await this.validateCustomerSegments(manager, coffeeShopId, input.customerConditions, (promotion.customerConditions ?? []).map((condition) => condition.customerSegmentId).filter((id): id is string => Boolean(id)));
      if (input.name !== undefined) promotion.name = name.trim();
      if (input.description !== undefined) promotion.description = input.description?.trim() || null;
      if (input.startAt !== undefined) promotion.startAt = input.startAt ? new Date(input.startAt) : null;
      if (input.endAt !== undefined) promotion.endAt = input.endAt ? new Date(input.endAt) : null;
      if (input.priority !== undefined) promotion.priority = input.priority;
      if (input.rewardType !== undefined) promotion.rewardType = rewardType;
      if (input.rewardValue !== undefined) promotion.rewardValue = String(input.rewardValue);
      if (input.entireOrder !== undefined) promotion.entireOrder = input.entireOrder;
      if (input.minimumSubtotalToman !== undefined) promotion.minimumSubtotalToman = input.minimumSubtotalToman === null ? null : String(input.minimumSubtotalToman);
      if (input.maxDiscountToman !== undefined) promotion.maxDiscountToman = input.maxDiscountToman === null ? null : String(input.maxDiscountToman);
      await manager.save(promotion);
      if (input.targets) {
        await manager.delete(PromotionTarget, { coffeeShopId, promotionId: id });
        if (input.targets.length) await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
          coffeeShopId, promotionId: id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
        })));
      }
      if (input.advancedRule !== undefined) {
        await manager.delete(PromotionAdvancedRule, { coffeeShopId, promotionId: id });
        if (input.advancedRule) {
          await manager.delete(PromotionTarget, { coffeeShopId, promotionId: id });
          await this.saveAdvancedRule(manager, coffeeShopId, id, input.advancedRule);
        }
      }
      if (input.customerConditions !== undefined) {
        await manager.delete(PromotionCustomerCondition, { coffeeShopId, promotionId: id });
        if (input.customerConditions.length) await this.saveCustomerConditions(manager, coffeeShopId, id, input.customerConditions);
      }
      if (input.schedule !== undefined) await this.saveSchedule(manager, coffeeShopId, id, input.schedule);
      let coupon = currentCoupon;
      if (input.couponCode && input.couponCode.trim().toUpperCase() !== coupon?.normalizedCode && await manager.findOneBy(PromotionCoupon, { coffeeShopId, normalizedCode: input.couponCode.trim().toUpperCase() })) throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." });
      if (input.couponCode && !coupon) coupon = manager.create(PromotionCoupon, { coffeeShopId, promotionId: id, isActive: true });
      if (coupon) {
        if (input.couponCode !== undefined) coupon.code = coupon.normalizedCode = input.couponCode.trim().toUpperCase();
        if (input.couponActive !== undefined) coupon.isActive = input.couponActive;
        if (input.couponStartsAt !== undefined) coupon.startsAt = input.couponStartsAt ? new Date(input.couponStartsAt) : null;
        if (input.couponExpiresAt !== undefined) coupon.expiresAt = input.couponExpiresAt ? new Date(input.couponExpiresAt) : null;
        if (input.totalUsageLimit !== undefined) coupon.totalUsageLimit = input.totalUsageLimit;
        if (input.perCustomerUsageLimit !== undefined) coupon.perCustomerUsageLimit = input.perCustomerUsageLimit;
        if (coupon.startsAt && coupon.expiresAt && coupon.expiresAt <= coupon.startsAt) throw new BadRequestException("Coupon end time must be after its start time");
        await manager.save(coupon);
      }
    }).catch((error: unknown) => { if ((error as { driverError?: { constraint?: string } }).driverError?.constraint === "uq_promotion_coupons_tenant_code") throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." }); throw error; });
    return this.get(coffeeShopId, id, tenantTimezone);
  }

  async setActive(coffeeShopId: string, id: string, isActive: boolean, timezone?: string) {
    const result = await this.dataSource.getRepository(Promotion).update({ id, coffeeShopId, deletedAt: IsNull() }, { isActive });
    if (!result.affected) throw new NotFoundException("Promotion not found");
    return this.get(coffeeShopId, id, timezone);
  }

  async archive(coffeeShopId: string, id: string) {
    const result = await this.dataSource.getRepository(Promotion).softDelete({ id, coffeeShopId, deletedAt: IsNull() });
    if (!result.affected) throw new NotFoundException("Promotion not found");
    return { archived: true };
  }

  private validateFields(type: PromotionRewardType, value: number, startAt?: string | null, endAt?: string | null, name?: string) {
    if (name !== undefined && !name.trim()) throw new BadRequestException("Promotion name is required");
    if (!Object.values(PromotionRewardType).includes(type)) throw new BadRequestException("Invalid promotion reward type");
    if (!Number.isSafeInteger(value) || (type === PromotionRewardType.Percentage && (value <= 0 || value > 100)) || (type === PromotionRewardType.FixedAmount && value <= 0) || (type === PromotionRewardType.FixedPrice && value < 0)) {
      throw new BadRequestException("Invalid promotion reward value");
    }
    if (startAt && Number.isNaN(Date.parse(startAt))) throw new BadRequestException("Invalid promotion start time");
    if (endAt && Number.isNaN(Date.parse(endAt))) throw new BadRequestException("Invalid promotion end time");
    if (startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) throw new BadRequestException("Promotion end time must be after its start time");
  }

  private validateOrderFields(entireOrder: boolean, type: PromotionRewardType, targets: Array<{ menuItemId?: string | null; categoryId?: string | null }>, maxDiscount?: number | null, coupon = false, advanced = false) {
    if (advanced) {
      if (entireOrder || targets.length || maxDiscount != null) throw new BadRequestException("Advanced promotions use rule targets and cannot use order caps");
      return;
    }
    if (entireOrder && targets.length) throw new BadRequestException("Entire-order promotions cannot select products or categories");
    if (!entireOrder && !targets.length) throw new BadRequestException("Select at least one promotion target");
    if (entireOrder && type === PromotionRewardType.FixedPrice) throw new BadRequestException("Fixed promotional price requires a product or category");
    if (maxDiscount != null && type !== PromotionRewardType.Percentage) throw new BadRequestException("Maximum discount requires a percentage reward");
    if (maxDiscount != null && !entireOrder && !coupon) throw new BadRequestException("Maximum discount requires an order promotion or coupon");
  }

  private validateAdvancedRule(rule: PromotionAdvancedRuleDto | null | undefined, entireOrder: boolean, targets: Array<{ menuItemId?: string | null; categoryId?: string | null }>, rewardType: PromotionRewardType, minimumSubtotal?: number | null, maxDiscount?: number | null) {
    if (!rule) return;
    if (entireOrder || targets.length || (minimumSubtotal != null && minimumSubtotal > 0) || maxDiscount != null) throw new BadRequestException("Advanced promotions use rule targets without order minimums or caps");
    const checkGroup = (group: PromotionRuleGroupDto | undefined) => {
      if (!group || !Number.isInteger(group.quantity) || group.quantity < 1 || group.quantity > 50 || !Array.isArray(group.targets) || !group.targets.length) throw new BadRequestException("Each advanced rule group needs a positive quantity and at least one product or category");
    };
    if (rule.type === AdvancedPromotionType.BuyXGetY) {
      if (rewardType === PromotionRewardType.FixedPrice || rule.bundleComponents || rule.quantityTarget || rule.tiers) throw new BadRequestException("Buy X Get Y needs a percentage or fixed-amount reward and buy/get groups");
      checkGroup(rule.buy); checkGroup(rule.get);
    } else if (rule.type === AdvancedPromotionType.Bundle) {
      if (rewardType !== PromotionRewardType.FixedPrice || rule.buy || rule.get || rule.quantityTarget || rule.tiers || !rule.bundleComponents || rule.bundleComponents.length < 2) throw new BadRequestException("A bundle needs at least two item groups and a fixed bundle price");
      rule.bundleComponents.forEach(checkGroup);
    } else if (rule.type === AdvancedPromotionType.QuantityTier) {
      if (!rule.quantityTarget || !rule.tiers?.length || rule.buy || rule.get || rule.bundleComponents) throw new BadRequestException("A quantity promotion needs targets and at least one tier");
      checkGroup(rule.quantityTarget);
      let previous = 0;
      for (const tier of rule.tiers) {
        if (!Number.isInteger(tier.minimumQuantity) || tier.minimumQuantity <= previous || tier.minimumQuantity > 50) throw new BadRequestException("Quantity tiers must have increasing, unique thresholds from 1 to 50");
        if ((tier.rewardType === PromotionRewardType.Percentage && (tier.rewardValue < 1 || tier.rewardValue > 100)) || (tier.rewardType === PromotionRewardType.FixedAmount && tier.rewardValue < 1)) throw new BadRequestException("Invalid quantity tier reward");
        previous = tier.minimumQuantity;
      }
    } else throw new BadRequestException("Invalid advanced promotion type");
  }

  private validateCouponDates(startAt?: string | null, endAt?: string | null) {
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) throw new BadRequestException("Coupon end time must be after its start time");
  }

  private validateCustomerConditions(conditions: PromotionCustomerConditionDto[]) {
    if (!Array.isArray(conditions) || conditions.length > 6 || new Set(conditions.map((condition) => condition.type)).size !== conditions.length) throw new BadRequestException("Customer conditions must contain at most one of each supported condition");
    for (const condition of conditions) {
      const hasOperator = condition.operator !== undefined;
      const hasValue = condition.value !== undefined;
      const hasSegment = condition.customerSegmentId !== undefined;
      if (condition.type === PromotionCustomerConditionType.FirstOrder) {
        if (hasOperator || hasValue || hasSegment) throw new BadRequestException("First-order condition takes no value");
      } else if (condition.type === PromotionCustomerConditionType.OrderCount) {
        if (![PromotionCustomerConditionOperator.AtLeast, PromotionCustomerConditionOperator.AtMost, PromotionCustomerConditionOperator.Exactly].includes(condition.operator!) || !Number.isSafeInteger(condition.value) || condition.value! < 0 || hasSegment) throw new BadRequestException("Order-count condition needs a comparison and non-negative order count");
      } else if (condition.type === PromotionCustomerConditionType.TotalSpent) {
        if (condition.operator !== PromotionCustomerConditionOperator.AtLeast || !Number.isSafeInteger(condition.value) || condition.value! < 0 || hasSegment) throw new BadRequestException("Total-spend condition needs a non-negative minimum");
      } else if (condition.type === PromotionCustomerConditionType.LastOrderAge) {
        if (condition.operator !== PromotionCustomerConditionOperator.AtLeast || !Number.isInteger(condition.value) || condition.value! < 1 || condition.value! > 36500 || hasSegment) throw new BadRequestException("Last-order age needs a day threshold from 1 to 36500");
      } else if (condition.type === PromotionCustomerConditionType.RegistrationAge) {
        if (![PromotionCustomerConditionOperator.AtLeast, PromotionCustomerConditionOperator.WithinLast].includes(condition.operator!) || !Number.isInteger(condition.value) || condition.value! < 1 || condition.value! > 36500 || hasSegment) throw new BadRequestException("Registration age needs a day threshold from 1 to 36500");
      } else if (condition.type === PromotionCustomerConditionType.CustomerSegment) {
        if (hasOperator || hasValue || !hasSegment) throw new BadRequestException("Customer segment condition needs one segment");
      }
    }
  }

  private async validateCustomerSegments(manager: EntityManager, coffeeShopId: string, conditions: PromotionCustomerConditionDto[], allowInactiveIds: string[] = []) {
    const ids = conditions.filter((condition) => condition.type === PromotionCustomerConditionType.CustomerSegment).map((condition) => condition.customerSegmentId!);
    if (!ids.length) return;
    const segments = await manager.getRepository(CustomerSegment).find({ where: { coffeeShopId, id: In(ids) }, withDeleted: true });
    if (segments.length !== ids.length || segments.some((segment) => (!segment.isActive || segment.deletedAt) && !allowInactiveIds.includes(segment.id))) throw new BadRequestException({ code: "CUSTOMER_SEGMENT_NOT_FOUND", message: "گروه انتخاب‌شده فعال و متعلق به همین کافه نیست." });
  }

  private saveCustomerConditions(manager: EntityManager, coffeeShopId: string, promotionId: string, conditions: PromotionCustomerConditionDto[]) {
    return manager.save(PromotionCustomerCondition, conditions.map((condition) => manager.create(PromotionCustomerCondition, {
      coffeeShopId, promotionId, type: condition.type, operator: condition.operator ?? null,
      value: condition.value === undefined ? null : String(condition.value), customerSegmentId: condition.customerSegmentId ?? null,
    })));
  }

  private validateSchedule(schedule: CreatePromotionDto["schedule"] | UpdatePromotionDto["schedule"], timezone: string) {
    if (schedule == null) return;
    if (!isValidTimeZone(timezone)) throw new BadRequestException("Cafe timezone must be a valid IANA timezone");
    if (!Array.isArray(schedule.windows) || !schedule.windows.length) throw new BadRequestException("A weekly schedule requires at least one time window");
    const keys = new Set<string>();
    for (const window of schedule.windows) {
      const days = window.daysOfWeek;
      if (!Array.isArray(days) || !days.length || days.some((day) => !(PROMOTION_WEEKDAYS as readonly string[]).includes(day)) || new Set(days).size !== days.length) {
        throw new BadRequestException("Select one or more unique valid weekdays for each schedule window");
      }
      const allDay = window.isAllDay ?? false;
      if (allDay ? window.startTime != null || window.endTime != null
        : !window.startTime || !window.endTime || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endTime) || window.startTime === window.endTime) {
        throw new BadRequestException("Each schedule window needs valid times, or must be marked all day");
      }
      const key = `${[...days].sort().join(",")}:${allDay ? "ALL" : `${window.startTime}-${window.endTime}`}`;
      if (keys.has(key)) throw new BadRequestException("Duplicate schedule windows are not allowed");
      keys.add(key);
    }
  }

  private async saveSchedule(manager: import("typeorm").EntityManager, coffeeShopId: string, promotionId: string, schedule: CreatePromotionDto["schedule"] | UpdatePromotionDto["schedule"]) {
    await manager.delete(PromotionScheduleWindow, { coffeeShopId, promotionId });
    if (!schedule) return;
    await manager.save(PromotionScheduleWindow, schedule.windows.map((window) => manager.create(PromotionScheduleWindow, {
      coffeeShopId, promotionId, daysOfWeek: window.daysOfWeek, isAllDay: window.isAllDay ?? false,
      startTime: window.isAllDay ? null : window.startTime!, endTime: window.isAllDay ? null : window.endTime!,
    })));
  }

  private async tenantTimezone(coffeeShopId: string, timezone?: string) {
    if (timezone) return timezone;
    const tenant = await this.dataSource.getRepository(CoffeeShop).findOne({ where: { id: coffeeShopId }, select: { id: true, timezone: true } });
    if (!tenant) throw new NotFoundException("Cafe not found");
    return tenant.timezone;
  }

  private async validateTargets(manager: import("typeorm").EntityManager, coffeeShopId: string, targets: PromotionTargetDto[]) {
    const itemIds: string[] = [];
    const categoryIds: string[] = [];
    for (const target of targets) {
      if (Boolean(target.menuItemId) === Boolean(target.categoryId)) throw new BadRequestException("Each promotion target must select one product or category");
      if (target.menuItemId) itemIds.push(target.menuItemId);
      if (target.categoryId) categoryIds.push(target.categoryId);
    }
    if (new Set(itemIds).size !== itemIds.length || new Set(categoryIds).size !== categoryIds.length) throw new BadRequestException("Promotion targets must be unique");
    const [items, categories] = await Promise.all([
      itemIds.length ? manager.find(MenuItem, { where: { id: In(itemIds), coffeeShopId, deletedAt: IsNull() } }) : [],
      categoryIds.length ? manager.find(MenuCategory, { where: { id: In(categoryIds), coffeeShopId, deletedAt: IsNull() } }) : [],
    ]);
    if (items.length !== itemIds.length || categories.length !== categoryIds.length) throw new BadRequestException("Promotion targets must belong to this cafe and be available");
  }

  private async validateAdvancedTargets(manager: import("typeorm").EntityManager, coffeeShopId: string, rule: PromotionAdvancedRuleDto) {
    const groups = [rule.buy, rule.get, ...(rule.bundleComponents ?? []), rule.quantityTarget].filter((group): group is PromotionRuleGroupDto => Boolean(group));
    for (const group of groups) await this.validateTargets(manager, coffeeShopId, group.targets);
  }

  private async saveAdvancedRule(manager: import("typeorm").EntityManager, coffeeShopId: string, promotionId: string, input: PromotionAdvancedRuleDto) {
    const rule = await manager.save(PromotionAdvancedRule, manager.create(PromotionAdvancedRule, {
      coffeeShopId, promotionId, type: input.type, repeatable: input.repeatable ?? true,
    }));
    const saveGroup = async (role: PromotionRuleGroupRole, position: number, value: PromotionRuleGroupDto) => {
      const group = await manager.save(PromotionRuleGroup, manager.create(PromotionRuleGroup, {
        coffeeShopId, ruleId: rule.id, role, position, quantity: value.quantity,
      }));
      await manager.save(PromotionRuleTarget, value.targets.map((target) => manager.create(PromotionRuleTarget, {
        coffeeShopId, groupId: group.id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
      })));
    };
    if (input.type === AdvancedPromotionType.BuyXGetY) {
      await saveGroup(PromotionRuleGroupRole.Buy, 0, input.buy!);
      await saveGroup(PromotionRuleGroupRole.Get, 0, input.get!);
    } else if (input.type === AdvancedPromotionType.Bundle) {
      for (const [position, component] of input.bundleComponents!.entries()) await saveGroup(PromotionRuleGroupRole.BundleItem, position, component);
    } else {
      await saveGroup(PromotionRuleGroupRole.QuantityTarget, 0, input.quantityTarget!);
      await manager.save(PromotionQuantityTier, input.tiers!.map((tier) => manager.create(PromotionQuantityTier, {
        coffeeShopId, ruleId: rule.id, minimumQuantity: tier.minimumQuantity, rewardType: tier.rewardType, rewardValue: String(tier.rewardValue),
      })));
    }
  }

  private ruleDto(rule: PromotionAdvancedRule | null | undefined): PromotionAdvancedRuleDto | null {
    if (!rule) return null;
    const groupDto = (role: PromotionRuleGroupRole, position = 0) => {
      const group = rule.groups?.find((candidate) => candidate.role === role && candidate.position === position);
      return group ? { quantity: group.quantity, targets: group.targets.map(({ menuItemId, categoryId }) => ({ menuItemId: menuItemId ?? undefined, categoryId: categoryId ?? undefined })) } : undefined;
    };
    if (rule.type === AdvancedPromotionType.BuyXGetY) return { type: rule.type, repeatable: rule.repeatable, buy: groupDto(PromotionRuleGroupRole.Buy), get: groupDto(PromotionRuleGroupRole.Get) };
    if (rule.type === AdvancedPromotionType.Bundle) return { type: rule.type, repeatable: rule.repeatable, bundleComponents: [...(rule.groups ?? [])].filter((group) => group.role === PromotionRuleGroupRole.BundleItem).sort((a, b) => a.position - b.position).map((group) => ({ quantity: group.quantity, targets: group.targets.map(({ menuItemId, categoryId }) => ({ menuItemId: menuItemId ?? undefined, categoryId: categoryId ?? undefined })) })) };
    return { type: rule.type, quantityTarget: groupDto(PromotionRuleGroupRole.QuantityTarget), tiers: [...(rule.tiers ?? [])].sort((a, b) => a.minimumQuantity - b.minimumQuantity).map(({ minimumQuantity, rewardType, rewardValue }) => ({ minimumQuantity, rewardType, rewardValue: Number(rewardValue) })) };
  }

  private async projectMany(coffeeShopId: string, promotions: Promotion[], timezone: string) {
    const coupons = promotions.length ? await this.dataSource.getRepository(PromotionCoupon).find({ where: { coffeeShopId, promotionId: In(promotions.map((promotion) => promotion.id)) } }) : [];
    const couponByPromotion = new Map(coupons.map((coupon) => [coupon.promotionId, coupon]));
    const targetRows = promotions.flatMap((promotion) => [...promotion.targets, ...(promotion.advancedRule?.groups.flatMap((group) => group.targets) ?? [])]);
    const itemIds = [...new Set(targetRows.map((target) => target.menuItemId).filter((id): id is string => Boolean(id)))];
    const categoryIds = [...new Set(targetRows.map((target) => target.categoryId).filter((id): id is string => Boolean(id)))];
    const [items, categories] = await Promise.all([
      itemIds.length ? this.dataSource.getRepository(MenuItem).find({ where: { id: In(itemIds), coffeeShopId, deletedAt: IsNull() } }) : [],
      categoryIds.length ? this.dataSource.getRepository(MenuCategory).find({ where: { id: In(categoryIds), coffeeShopId, deletedAt: IsNull() } }) : [],
    ]);
    const itemById = new Map(items.map((item) => [item.id, item.name]));
    const categoryById = new Map(categories.map((category) => [category.id, category.name]));
    const segmentIds = [...new Set(promotions.flatMap((promotion) => (promotion.customerConditions ?? []).map((condition) => condition.customerSegmentId).filter((id): id is string => Boolean(id))))];
    const segments = segmentIds.length ? await this.dataSource.getRepository(CustomerSegment).find({ where: { coffeeShopId, id: In(segmentIds) }, withDeleted: true }) : [];
    const segmentById = new Map(segments.map((segment) => [segment.id, segment.name]));
    const now = new Date();
    return promotions.map((promotion) => ({
      id: promotion.id, name: promotion.name, description: promotion.description, isActive: promotion.isActive,
      status: promotionStatus(promotion, now, timezone), startAt: promotion.startAt, endAt: promotion.endAt, priority: promotion.priority,
      rewardType: promotion.rewardType, rewardValue: promotion.rewardValue,
      entireOrder: promotion.entireOrder, minimumSubtotalToman: promotion.minimumSubtotalToman, maxDiscountToman: promotion.maxDiscountToman,
      coupon: couponByPromotion.get(promotion.id) ?? null,
      schedule: promotion.scheduleWindows?.length ? { windows: [...promotion.scheduleWindows].sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? "")).map((window) => ({ daysOfWeek: window.daysOfWeek, startTime: window.startTime?.slice(0, 5) ?? null, endTime: window.endTime?.slice(0, 5) ?? null, isAllDay: window.isAllDay })) } : null,
      targets: promotion.targets.map((target) => target.menuItemId
        ? { type: "PRODUCT" as const, id: target.menuItemId, name: itemById.get(target.menuItemId) ?? null }
        : { type: "CATEGORY" as const, id: target.categoryId!, name: categoryById.get(target.categoryId!) ?? null }),
      advancedRule: this.ruleDto(promotion.advancedRule),
      customerConditions: (promotion.customerConditions ?? []).map((condition) => ({ type: condition.type, operator: condition.operator, value: condition.value, customerSegmentId: condition.customerSegmentId, customerSegmentName: condition.customerSegmentId ? segmentById.get(condition.customerSegmentId) ?? null : null })),
      createdAt: promotion.createdAt, updatedAt: promotion.updatedAt,
    }));
  }
}
