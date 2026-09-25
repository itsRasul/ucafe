import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { MenuCategory, MenuItem } from "../menu/entities";
import { CreatePromotionDto, PromotionTargetDto, UpdatePromotionDto } from "./dto/promotion.dto";
import { Promotion, PromotionCoupon, PromotionRewardType, PromotionTarget } from "./entities";
import { promotionStatus } from "./promotion-pricing.util";

@Injectable()
export class PromotionsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string) {
    const promotions = await this.dataSource.getRepository(Promotion).find({ where: { coffeeShopId }, relations: { targets: true }, order: { updatedAt: "DESC" }, withDeleted: true });
    return this.projectMany(coffeeShopId, promotions);
  }

  async get(coffeeShopId: string, id: string) {
    const promotion = await this.dataSource.getRepository(Promotion).findOne({ where: { id, coffeeShopId }, relations: { targets: true }, withDeleted: true });
    if (!promotion) throw new NotFoundException("Promotion not found");
    return (await this.projectMany(coffeeShopId, [promotion]))[0];
  }

  async create(coffeeShopId: string, actorUserId: string, input: CreatePromotionDto) {
    this.validateFields(input.rewardType, input.rewardValue, input.startAt, input.endAt, input.name);
    this.validateOrderFields(input.entireOrder, input.rewardType, input.targets, input.maxDiscountToman, Boolean(input.couponCode));
    this.validateCouponDates(input.couponStartsAt, input.couponExpiresAt);
    const id = await this.dataSource.transaction(async (manager) => {
      if (!input.entireOrder) await this.validateTargets(manager, coffeeShopId, input.targets);
      if (input.couponCode && await manager.findOneBy(PromotionCoupon, { coffeeShopId, normalizedCode: input.couponCode.trim().toUpperCase() })) throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." });
      const promotion = await manager.save(Promotion, manager.create(Promotion, {
        coffeeShopId, name: input.name.trim(), description: input.description?.trim() || null,
        isActive: input.isActive, startAt: input.startAt ? new Date(input.startAt) : null, endAt: input.endAt ? new Date(input.endAt) : null,
        priority: input.priority, rewardType: input.rewardType, rewardValue: String(input.rewardValue), createdByUserId: actorUserId,
        entireOrder: input.entireOrder, minimumSubtotalToman: input.minimumSubtotalToman == null ? null : String(input.minimumSubtotalToman),
        maxDiscountToman: input.maxDiscountToman == null ? null : String(input.maxDiscountToman),
      }));
      await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
        coffeeShopId, promotionId: promotion.id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
      })));
      if (input.couponCode) await manager.save(PromotionCoupon, manager.create(PromotionCoupon, {
        coffeeShopId, promotionId: promotion.id, code: input.couponCode.trim().toUpperCase(), normalizedCode: input.couponCode.trim().toUpperCase(),
        isActive: input.couponActive ?? true, startsAt: input.couponStartsAt ? new Date(input.couponStartsAt) : null,
        expiresAt: input.couponExpiresAt ? new Date(input.couponExpiresAt) : null,
        totalUsageLimit: input.totalUsageLimit ?? null, perCustomerUsageLimit: input.perCustomerUsageLimit ?? null,
      }));
      return promotion.id;
    }).catch((error: unknown) => { if ((error as { driverError?: { constraint?: string } }).driverError?.constraint === "uq_promotion_coupons_tenant_code") throw new BadRequestException({ code: "COUPON_CODE_IN_USE", message: "این کد تخفیف قبلاً ثبت شده است." }); throw error; });
    return this.get(coffeeShopId, id);
  }

  async update(coffeeShopId: string, id: string, input: UpdatePromotionDto) {
    await this.dataSource.transaction(async (manager) => {
      const promotion = await manager.findOne(Promotion, { where: { id, coffeeShopId }, relations: { targets: true } });
      if (!promotion) throw new NotFoundException("Promotion not found");
      const rewardType = input.rewardType ?? promotion.rewardType;
      const rewardValue = input.rewardValue ?? Number(promotion.rewardValue);
      const name = input.name ?? promotion.name;
      const startAt = input.startAt === undefined ? promotion.startAt?.toISOString() : input.startAt ?? undefined;
      const endAt = input.endAt === undefined ? promotion.endAt?.toISOString() : input.endAt ?? undefined;
      this.validateFields(rewardType, rewardValue, startAt, endAt, name);
      const entireOrder = input.entireOrder ?? promotion.entireOrder;
      const targets = input.targets ?? promotion.targets;
      const currentCoupon = await manager.findOneBy(PromotionCoupon, { coffeeShopId, promotionId: id });
      this.validateOrderFields(entireOrder, rewardType, targets, input.maxDiscountToman === undefined ? (promotion.maxDiscountToman ? Number(promotion.maxDiscountToman) : null) : input.maxDiscountToman, Boolean(currentCoupon || input.couponCode));
      this.validateCouponDates(input.couponStartsAt === undefined ? currentCoupon?.startsAt?.toISOString() : input.couponStartsAt, input.couponExpiresAt === undefined ? currentCoupon?.expiresAt?.toISOString() : input.couponExpiresAt);
      if (input.targets && !entireOrder) await this.validateTargets(manager, coffeeShopId, input.targets);
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
        await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
          coffeeShopId, promotionId: id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
        })));
      }
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
    return this.get(coffeeShopId, id);
  }

  async setActive(coffeeShopId: string, id: string, isActive: boolean) {
    const result = await this.dataSource.getRepository(Promotion).update({ id, coffeeShopId, deletedAt: IsNull() }, { isActive });
    if (!result.affected) throw new NotFoundException("Promotion not found");
    return this.get(coffeeShopId, id);
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

  private validateOrderFields(entireOrder: boolean, type: PromotionRewardType, targets: Array<{ menuItemId?: string | null; categoryId?: string | null }>, maxDiscount?: number | null, coupon = false) {
    if (entireOrder && targets.length) throw new BadRequestException("Entire-order promotions cannot select products or categories");
    if (!entireOrder && !targets.length) throw new BadRequestException("Select at least one promotion target");
    if (entireOrder && type === PromotionRewardType.FixedPrice) throw new BadRequestException("Fixed promotional price requires a product or category");
    if (maxDiscount != null && type !== PromotionRewardType.Percentage) throw new BadRequestException("Maximum discount requires a percentage reward");
    if (maxDiscount != null && !entireOrder && !coupon) throw new BadRequestException("Maximum discount requires an order promotion or coupon");
  }

  private validateCouponDates(startAt?: string | null, endAt?: string | null) {
    if (startAt && endAt && new Date(endAt) <= new Date(startAt)) throw new BadRequestException("Coupon end time must be after its start time");
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

  private async projectMany(coffeeShopId: string, promotions: Promotion[]) {
    const coupons = promotions.length ? await this.dataSource.getRepository(PromotionCoupon).find({ where: { coffeeShopId, promotionId: In(promotions.map((promotion) => promotion.id)) } }) : [];
    const couponByPromotion = new Map(coupons.map((coupon) => [coupon.promotionId, coupon]));
    const targetRows = promotions.flatMap((promotion) => promotion.targets);
    const itemIds = [...new Set(targetRows.map((target) => target.menuItemId).filter((id): id is string => Boolean(id)))];
    const categoryIds = [...new Set(targetRows.map((target) => target.categoryId).filter((id): id is string => Boolean(id)))];
    const [items, categories] = await Promise.all([
      itemIds.length ? this.dataSource.getRepository(MenuItem).find({ where: { id: In(itemIds), coffeeShopId, deletedAt: IsNull() } }) : [],
      categoryIds.length ? this.dataSource.getRepository(MenuCategory).find({ where: { id: In(categoryIds), coffeeShopId, deletedAt: IsNull() } }) : [],
    ]);
    const itemById = new Map(items.map((item) => [item.id, item.name]));
    const categoryById = new Map(categories.map((category) => [category.id, category.name]));
    const now = new Date();
    return promotions.map((promotion) => ({
      id: promotion.id, name: promotion.name, description: promotion.description, isActive: promotion.isActive,
      status: promotionStatus(promotion, now), startAt: promotion.startAt, endAt: promotion.endAt, priority: promotion.priority,
      rewardType: promotion.rewardType, rewardValue: promotion.rewardValue,
      entireOrder: promotion.entireOrder, minimumSubtotalToman: promotion.minimumSubtotalToman, maxDiscountToman: promotion.maxDiscountToman,
      coupon: couponByPromotion.get(promotion.id) ?? null,
      targets: promotion.targets.map((target) => target.menuItemId
        ? { type: "PRODUCT" as const, id: target.menuItemId, name: itemById.get(target.menuItemId) ?? null }
        : { type: "CATEGORY" as const, id: target.categoryId!, name: categoryById.get(target.categoryId!) ?? null }),
      createdAt: promotion.createdAt, updatedAt: promotion.updatedAt,
    }));
  }
}
