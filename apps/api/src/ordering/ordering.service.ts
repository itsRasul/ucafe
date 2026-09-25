import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { Client, ClientAddress } from "../clients/entities";
import { Branch, CoffeeShop } from "../database/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { NotificationsService } from "../notifications/notifications.service";
import { displayOrderNumber, displayToman, NotificationType } from "../notifications/notification-type";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { InventoryService } from "../inventory/inventory.service";
import { PricingContext, PromotionPricingService } from "../promotions/promotion-pricing.service";
import { PricingUnit } from "../promotions/promotion-advanced.util";
import { Promotion, PromotionCoupon, PromotionRedemption, RedemptionStatus } from "../promotions/entities";
import { discountFor, promotionStatus } from "../promotions/promotion-pricing.util";
import { CheckoutAddressDto, CheckoutLineDto, ClientOrdersQueryDto, CreateOrderDto, OrdersQueryDto, UpdateOnlineOrderingSettingsDto } from "./dto/ordering.dto";
import { OnlineOrderingSettings, Order, OrderDeliveryMethod, OrderItem, OrderPaymentMethod, OrderSource, OrderStatus } from "./entities";
import { nextOrderStatuses } from "./order-status.util";

type UnavailableLine = { menuItemId: string; variantId: string | null; reason: string; name?: string };

@Injectable()
export class OrderingService {
  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService, private readonly notifications: NotificationsService, private readonly inventory: InventoryService, @Inject(PromotionPricingService) private readonly promotionPricing = new PromotionPricingService()) { }

  async publicState(coffeeShopId: string) {
    const [feature, settings, branch] = await Promise.all([
      this.subscriptions.featureState(coffeeShopId, SubscriptionFeatures.OnlineOrdering),
      this.settingsOrDefault(coffeeShopId),
      this.dataSource.getRepository(Branch).findOneBy({ coffeeShopId, isPrimary: true, isActive: true }),
    ]);
    return {
      onlineOrderingAvailable: feature.enabled,
      unavailableMessage: feature.enabled ? null : "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد.",
      paymentMethods: [{ key: OrderPaymentMethod.Offline, label: "پرداخت حضوری", enabled: settings.offlinePaymentEnabled }],
      deliveryMethods: [
        { key: OrderDeliveryMethod.Pickup, label: "تحویل در کافه", enabled: settings.pickupEnabled, address: branch?.address ?? null },
        { key: OrderDeliveryMethod.Courier, label: "تحویل با پیک", enabled: settings.courierEnabled },
      ],
    };
  }

  async getSettings(coffeeShopId: string) {
    const repository = this.dataSource.getRepository(OnlineOrderingSettings);
    let settings = await repository.findOneBy({ coffeeShopId });
    if (!settings) settings = await repository.save(repository.create({ coffeeShopId }));
    return settings;
  }

  private async settingsOrDefault(coffeeShopId: string) {
    const repository = this.dataSource.getRepository(OnlineOrderingSettings);
    return await repository.findOneBy({ coffeeShopId }) ?? repository.create({ coffeeShopId });
  }

  async updateSettings(coffeeShopId: string, input: UpdateOnlineOrderingSettingsDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.OnlineOrdering);
    const settings = await this.getSettings(coffeeShopId);
    if (input.pickupEnabled !== undefined) settings.pickupEnabled = input.pickupEnabled;
    if (input.courierEnabled !== undefined) settings.courierEnabled = input.courierEnabled;
    if (input.offlinePaymentEnabled !== undefined) settings.offlinePaymentEnabled = input.offlinePaymentEnabled;
    if (input.notifyAdminNewOrder !== undefined) settings.notifyAdminNewOrder = input.notifyAdminNewOrder;
    return this.dataSource.getRepository(OnlineOrderingSettings).save(settings);
  }

  async createOrder(coffeeShopId: string, clientId: string, input: CreateOrderDto, tenantTimezone?: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`order:${coffeeShopId}:${clientId}:${input.idempotencyKey}`]);
      const existing = await manager.findOne(Order, { where: { coffeeShopId, clientId, idempotencyKey: input.idempotencyKey }, relations: { client: true, items: true } });
      if (existing) return this.clientProject(existing);

      await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.OnlineOrdering);
      const settings = await manager.findOneBy(OnlineOrderingSettings, { coffeeShopId }) ?? await manager.save(OnlineOrderingSettings, manager.create(OnlineOrderingSettings, { coffeeShopId }));
      if (input.paymentMethod !== OrderPaymentMethod.Offline || !settings.offlinePaymentEnabled) throw new ForbiddenException({ code: "PAYMENT_METHOD_UNAVAILABLE", message: "Selected payment method is unavailable" });
      if (input.deliveryMethod === OrderDeliveryMethod.Pickup && !settings.pickupEnabled) throw new ForbiddenException({ code: "DELIVERY_METHOD_UNAVAILABLE", message: "Selected delivery method is unavailable" });
      if (input.deliveryMethod === OrderDeliveryMethod.Courier && !settings.courierEnabled) throw new ForbiddenException({ code: "DELIVERY_METHOD_UNAVAILABLE", message: "Selected delivery method is unavailable" });

      const client = await manager.findOneBy(Client, { id: clientId, coffeeShopId });
      if (!client) throw new NotFoundException("Client not found");

      const branch = await manager.findOneBy(Branch, { coffeeShopId, isPrimary: true, isActive: true });
      const address = input.deliveryMethod === OrderDeliveryMethod.Courier ? await this.resolveAddress(manager, coffeeShopId, clientId, input.addressId, input.newAddress) : null;
      const pricingTime = new Date();
      const priced = await this.priceCart(manager, coffeeShopId, input.items, pricingTime, input.couponCode, clientId, true, tenantTimezone);
      const { lines, total, subtotal, discountTotal, orderDiscount, couponDiscount, promotion, coupon } = priced;

      const order = await manager.save(Order, manager.create(Order, {
        coffeeShopId,
        clientId,
        branchId: branch?.id ?? null,
        status: OrderStatus.UnderReview,
        paymentMethod: input.paymentMethod,
        deliveryMethod: input.deliveryMethod,
        orderSource: OrderSource.PublicClient,
        deliveryAddressId: address?.id ?? null,
        deliveryAddressSnapshot: address ? this.addressSnapshot(address) : null,
        totalAmountToman: total.toString(),
        subtotalBeforeDiscountToman: subtotal.toString(),
        discountTotalToman: discountTotal.toString(),
        orderDiscountToman: orderDiscount.toString(),
        orderPromotionIdSnapshot: orderDiscount > 0n ? promotion?.id ?? null : null, orderPromotionNameSnapshot: orderDiscount > 0n ? promotion?.name ?? null : null,
        orderPromotionRewardTypeSnapshot: orderDiscount > 0n ? promotion?.rewardType ?? null : null, orderPromotionRewardValueSnapshot: orderDiscount > 0n ? promotion?.rewardValue ?? null : null,
        couponCodeSnapshot: coupon?.code ?? null,
        idempotencyKey: input.idempotencyKey,
        customerNote: input.customerNote?.trim() || null,
      }));
      await manager.save(OrderItem, lines.map((line) => manager.create(OrderItem, { ...line, coffeeShopId, orderId: order.id })));
      if (coupon) await manager.save(PromotionRedemption, manager.create(PromotionRedemption, {
        coffeeShopId, promotionId: coupon.promotionId, couponId: coupon.id, customerId: clientId, orderId: order.id,
        discountAmountToman: couponDiscount.toString(), status: RedemptionStatus.Applied,
      }));
      const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
      const orderNumber = displayOrderNumber(order.id);
      const payload = { customerName: client.firstName, orderNumber, cafeName: cafe.name, totalPrice: displayToman(order.totalAmountToman) };
      await this.notifications.enqueue(manager, { coffeeShopId, type: NotificationType.OrderPlaced, relatedEntityType: "order", relatedEntityId: order.id, deduplicationKey: `${NotificationType.OrderPlaced}:${order.id}`, phone: client.phone, payload });
      if (settings.notifyAdminNewOrder) await this.notifications.enqueueOwners(manager, { coffeeShopId, type: NotificationType.AdminNewOrder, relatedEntityType: "order", relatedEntityId: order.id, deduplicationKey: `${NotificationType.AdminNewOrder}:${order.id}`, payload: { cafeName: cafe.name, orderNumber, totalPrice: payload.totalPrice } });
      const saved = await manager.findOneOrFail(Order, { where: { id: order.id }, relations: { client: true, items: true } });
      return this.clientProject(saved);
    });
  }

  async quote(coffeeShopId: string, input: CheckoutLineDto[], couponCode?: string, clientId?: string, tenantTimezone?: string) {
    const { lines, subtotal, total, discountTotal, orderDiscount, promotion, coupon } = await this.priceCart(this.dataSource.manager, coffeeShopId, input, new Date(), couponCode, clientId, false, tenantTimezone);
    return {
      items: lines.map((line) => ({ menuItemId: line.menuItemId, variantId: line.menuItemVariantId, quantity: line.quantity, itemName: line.itemName, variantName: line.variantName, originalUnitPriceToman: line.originalUnitPriceToman, unitPriceToman: line.unitPriceToman, discountAmountToman: line.discountAmountToman, lineTotalToman: line.lineTotalToman, promotionName: line.promotionNameSnapshot, promotionType: line.promotionTypeSnapshot, allocationType: line.promotionAllocationTypeSnapshot, ruleSummary: line.promotionRuleSnapshot })),
      subtotalBeforeDiscountToman: subtotal.toString(), itemDiscountTotalToman: (discountTotal - orderDiscount).toString(),
      orderDiscountToman: orderDiscount.toString(), discountTotalToman: discountTotal.toString(), totalAmountToman: total.toString(),
      couponCode: coupon?.code ?? null, orderPromotionName: orderDiscount > 0n ? promotion?.name ?? null : null, deliveryFeeToman: "0",
    };
  }

  async clientList(coffeeShopId: string, clientId: string, query: ClientOrdersQueryDto) {
    const [items, total] = await this.dataSource.getRepository(Order).findAndCount({
      where: { coffeeShopId, clientId },
      order: { createdAt: "DESC" },
      skip: (query.page - 1) * query.pageSize,
      take: query.pageSize,
    });
    return { items: items.map((order) => this.clientSummary(order)), total, page: query.page, pageSize: query.pageSize };
  }

  async clientDetail(coffeeShopId: string, clientId: string, id: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id, coffeeShopId, clientId }, relations: { client: true, items: true } });
    if (!order) throw new NotFoundException("Order not found");
    return this.clientProject(order);
  }

  async list(coffeeShopId: string, query: OrdersQueryDto) {
    const qb = this.dataSource.getRepository(Order).createQueryBuilder("order")
      .leftJoinAndSelect("order.client", "client")
      .where("order.coffeeShopId = :coffeeShopId", { coffeeShopId })
      .orderBy("order.createdAt", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    if (query.status) qb.andWhere("order.status = :status", { status: query.status });
    if (query.fromDate) qb.andWhere("order.createdAt >= :fromDate", { fromDate: `${query.fromDate}T00:00:00.000Z` });
    if (query.toDate) qb.andWhere("order.createdAt < :toDate", { toDate: `${query.toDate}T23:59:59.999Z` });
    const [items, total] = await qb.getManyAndCount();
    return { items: items.map((order) => this.summary(order)), total, page: query.page, pageSize: query.pageSize };
  }

  async detail(coffeeShopId: string, id: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id, coffeeShopId }, relations: { client: true, items: true } });
    if (!order) throw new NotFoundException("Order not found");
    return this.adminProject(order);
  }

  async updateStatus(coffeeShopId: string, id: string, actorUserId: string, next: OrderStatus) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(Order).createQueryBuilder("order").setLock("pessimistic_write").where("order.id = :id AND order.coffeeShopId = :coffeeShopId", { id, coffeeShopId }).getOne();
      if (!order) throw new NotFoundException("Order not found");
      if (!this.nextStatuses(order).includes(next)) throw new ConflictException("Invalid order status transition");
      if (order.status === OrderStatus.UnderReview && next === OrderStatus.Preparing) await this.inventory.consumeOrder(manager, coffeeShopId, id, actorUserId);
      if (next === OrderStatus.Canceled) await this.inventory.reverseOrder(manager, coffeeShopId, id, actorUserId);
      if (next === OrderStatus.Canceled && order.status === OrderStatus.UnderReview) {
        await manager.update(PromotionRedemption, { coffeeShopId, orderId: id, status: RedemptionStatus.Applied }, { status: RedemptionStatus.Released });
      }
      order.status = next;
      order.statusChangedAt = new Date();
      order.statusChangedByUserId = actorUserId;
      await manager.save(order);
      const saved = await manager.findOneOrFail(Order, { where: { id, coffeeShopId }, relations: { client: true, items: true } });
      const type = this.notificationType(saved);
      if (type) {
        const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
        await this.notifications.enqueue(manager, { coffeeShopId, type, relatedEntityType: "order", relatedEntityId: id, deduplicationKey: `${type}:${id}`, phone: saved.client.phone, payload: { customerName: saved.client.firstName, orderNumber: displayOrderNumber(id), cafeName: cafe.name } });
      }
      // return this.project(saved);
      return this.adminProject(saved);
    });
  }

  private async resolveAddress(manager: import("typeorm").EntityManager, coffeeShopId: string, clientId: string, addressId?: string, newAddress?: CheckoutAddressDto) {
    if (addressId) {
      const address = await manager.findOneBy(ClientAddress, { id: addressId, coffeeShopId, clientId, deletedAt: IsNull() });
      if (!address) throw new NotFoundException("Client address not found");
      return address;
    }
    if (!newAddress) throw new BadRequestException({ code: "DELIVERY_ADDRESS_REQUIRED", message: "Delivery address is required" });
    if (newAddress.isDefault) await manager.update(ClientAddress, { coffeeShopId, clientId, deletedAt: IsNull() }, { isDefault: false });
    return manager.save(ClientAddress, manager.create(ClientAddress, { coffeeShopId, clientId, label: newAddress.label?.trim() || null, province: newAddress.province.trim(), city: newAddress.city.trim(), addressLine: newAddress.addressLine.trim(), buildingNumber: newAddress.buildingNumber.trim(), unit: newAddress.unit?.trim() || null, postalCode: newAddress.postalCode || null, isDefault: newAddress.isDefault ?? false }));
  }

  private addressSnapshot(address: ClientAddress) {
    return { label: address.label, province: address.province, city: address.city, addressLine: address.addressLine, buildingNumber: address.buildingNumber, unit: address.unit, postalCode: address.postalCode };
  }

  private async priceCart(manager: import("typeorm").EntityManager, coffeeShopId: string, input: CheckoutLineDto[], now: Date, couponCode?: string, clientId?: string, lockCoupon = false, tenantTimezone?: string) {
    if (!tenantTimezone) {
      const tenant = await manager.findOne(CoffeeShop, { where: { id: coffeeShopId }, select: { id: true, timezone: true } });
      if (!tenant) throw new NotFoundException("Cafe not found");
      tenantTimezone = tenant.timezone;
    }
    const normalized = couponCode?.trim().toUpperCase();
    if (normalized && (!clientId || !/^[A-Z0-9_-]{3,64}$/.test(normalized))) throw new BadRequestException({ code: "COUPON_NOT_FOUND", message: "کد تخفیف یافت نشد." });
    let coupon: PromotionCoupon | null = null;
    let couponPromotion: Promotion | null = null;
    if (normalized) {
      const query = manager.getRepository(PromotionCoupon).createQueryBuilder("coupon")
        .where("coupon.coffeeShopId = :coffeeShopId AND coupon.normalizedCode = :normalized", { coffeeShopId, normalized });
      if (lockCoupon) query.setLock("pessimistic_write");
      coupon = await query.getOne();
      if (!coupon) throw new BadRequestException({ code: "COUPON_NOT_FOUND", message: "کد تخفیف یافت نشد." });
      if (!coupon.isActive) throw new BadRequestException({ code: "COUPON_INACTIVE", message: "کد تخفیف غیرفعال است." });
      if (coupon.startsAt && coupon.startsAt > now) throw new BadRequestException({ code: "COUPON_NOT_STARTED", message: "زمان استفاده از این کد هنوز شروع نشده است." });
      if (coupon.expiresAt && coupon.expiresAt <= now) throw new BadRequestException({ code: "COUPON_EXPIRED", message: "مهلت استفاده از این کد پایان یافته است." });
      couponPromotion = await manager.findOne(Promotion, { where: { id: coupon.promotionId, coffeeShopId }, relations: { targets: true, scheduleWindows: true, advancedRule: { groups: { targets: true }, tiers: true } } });
      if (!couponPromotion || promotionStatus(couponPromotion, now, tenantTimezone) !== "RUNNING") throw new BadRequestException({ code: "PROMOTION_NOT_APPLICABLE", message: "این تخفیف در حال حاضر قابل استفاده نیست." });
      const used = await manager.count(PromotionRedemption, { where: { coffeeShopId, couponId: coupon.id, status: RedemptionStatus.Applied } });
      if (coupon.totalUsageLimit !== null && used >= coupon.totalUsageLimit) throw new BadRequestException({ code: "COUPON_USAGE_LIMIT_REACHED", message: "ظرفیت استفاده از این کد به پایان رسیده است." });
      const customerUsed = await manager.count(PromotionRedemption, { where: { coffeeShopId, couponId: coupon.id, customerId: clientId!, status: RedemptionStatus.Applied } });
      if (coupon.perCustomerUsageLimit !== null && customerUsed >= coupon.perCustomerUsageLimit) throw new BadRequestException({ code: "CUSTOMER_USAGE_LIMIT_REACHED", message: "شما قبلاً از این کد استفاده کرده‌اید." });
    }
    const context = await this.promotionPricing.loadContext(manager, coffeeShopId, now, tenantTimezone);
    const lines = await this.priceLines(manager, coffeeShopId, input, context, couponPromotion ? [couponPromotion] : []);
    const subtotal = lines.reduce((sum, line) => sum + BigInt(line.originalUnitPriceToman) * BigInt(line.quantity), 0n);
    const itemTotal = lines.reduce((sum, line) => sum + BigInt(line.lineTotalToman), 0n);
    const candidates = couponPromotion && !couponPromotion.advancedRule ? [...context.order, couponPromotion] : context.order;
    let promotion: Promotion | null = null;
    let orderDiscount = 0n;
    for (const candidate of candidates) {
      if (candidate.minimumSubtotalToman !== null && itemTotal < BigInt(candidate.minimumSubtotalToman)) {
        if (couponPromotion) throw new BadRequestException({ code: "MINIMUM_ORDER_NOT_MET", message: `حداقل مبلغ سفارش برای این کد ${candidate.minimumSubtotalToman} تومان است.` });
        continue;
      }
      const eligible = candidate.entireOrder ? itemTotal : lines.reduce((sum, line) => {
        const matches = candidate.targets.some((target) => target.menuItemId === line.menuItemId || target.categoryId === line.categoryIdSnapshot);
        return sum + (matches ? BigInt(line.lineTotalToman) : 0n);
      }, 0n);
      const reward = { id: candidate.id, name: candidate.name, priority: candidate.priority, rewardType: candidate.rewardType, rewardValue: candidate.rewardValue };
      let amount = candidate.entireOrder ? discountFor(eligible, reward) : lines.reduce((sum, line) => {
        const matches = candidate.targets.some((target) => target.menuItemId === line.menuItemId || target.categoryId === line.categoryIdSnapshot);
        return sum + (matches ? discountFor(BigInt(line.unitPriceToman), reward) * BigInt(line.quantity) : 0n);
      }, 0n);
      if (candidate.maxDiscountToman !== null && amount > BigInt(candidate.maxDiscountToman)) amount = BigInt(candidate.maxDiscountToman);
      if (amount > eligible) amount = eligible;
      if (amount > orderDiscount || (amount === orderDiscount && amount > 0n && promotion && (candidate.priority > promotion.priority || (candidate.priority === promotion.priority && candidate.id < promotion.id)))) {
        promotion = candidate; orderDiscount = amount;
      }
    }
    let couponDiscount = 0n;
    if (couponPromotion?.advancedRule) {
      const applied = lines.some((line) => line.promotionIdSnapshot === couponPromotion!.id);
      if (!applied) throw new BadRequestException({ code: "PROMOTION_NOT_APPLICABLE", message: "این کد برای سبد خرید شما تخفیف بهتری ایجاد نمی‌کند؛ کد را حذف کنید." });
      promotion = couponPromotion;
      couponDiscount = lines.filter((line) => line.promotionIdSnapshot === couponPromotion!.id).reduce((sum, line) => sum + BigInt(line.discountAmountToman) * BigInt(line.quantity), 0n);
    } else if (couponPromotion && (!orderDiscount || promotion?.id !== couponPromotion.id)) throw new BadRequestException({ code: "PROMOTION_NOT_APPLICABLE", message: "این کد برای سبد خرید شما تخفیف بهتری ایجاد نمی‌کند؛ کد را حذف کنید." });
    if (!promotion && !couponPromotion?.advancedRule) coupon = null;
    const total = itemTotal - orderDiscount;
    if (couponPromotion && !couponDiscount) couponDiscount = orderDiscount;
    return { lines, subtotal, total, discountTotal: subtotal - total, orderDiscount, couponDiscount, promotion, coupon };
  }

  private async priceLines(manager: import("typeorm").EntityManager, coffeeShopId: string, input: CheckoutLineDto[], pricingContext: PricingContext, supplementalPromotions: Promotion[] = []) {
    const merged = new Map<string, CheckoutLineDto>();
    for (const line of input) {
      const key = `${line.menuItemId}:${line.variantId ?? ""}`;
      const current = merged.get(key);
      merged.set(key, current ? { ...line, quantity: current.quantity + line.quantity } : { ...line });
    }
    const lines = [...merged.values()].sort((a, b) => a.menuItemId.localeCompare(b.menuItemId) || (a.variantId ?? "").localeCompare(b.variantId ?? ""));
    if (!lines.length) throw new BadRequestException("Cart is empty");
    if (lines.reduce((sum, line) => sum + line.quantity, 0) > 50 || lines.some((line) => line.quantity < 1 || line.quantity > 20)) throw new BadRequestException("Invalid cart quantity");

    const items = await manager.find(MenuItem, { where: { id: In(lines.map((line) => line.menuItemId)), coffeeShopId, deletedAt: IsNull() }, relations: { variants: true, category: true } });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const unavailable: UnavailableLine[] = [];
    const units: PricingUnit[] = [];

    for (const line of lines) {
      const item = itemById.get(line.menuItemId);
      if (!item) { unavailable.push({ menuItemId: line.menuItemId, variantId: line.variantId ?? null, reason: "NOT_FOUND" }); continue; }
      if (!item.isAvailable) { unavailable.push({ menuItemId: item.id, variantId: line.variantId ?? null, reason: "ITEM_UNAVAILABLE", name: item.name }); continue; }
      if (!item.category?.isActive || item.category.deletedAt) { unavailable.push({ menuItemId: item.id, variantId: line.variantId ?? null, reason: "CATEGORY_UNAVAILABLE", name: item.name }); continue; }

      let unitPrice: string | null = item.basePriceToman;
      let variant: MenuItemVariant | undefined;
      if (item.variants.length) {
        if (!line.variantId) { unavailable.push({ menuItemId: item.id, variantId: null, reason: "VARIANT_REQUIRED", name: item.name }); continue; }
        variant = item.variants.find((candidate) => candidate.id === line.variantId);
        if (!variant || !variant.isAvailable) { unavailable.push({ menuItemId: item.id, variantId: line.variantId, reason: "VARIANT_UNAVAILABLE", name: item.name }); continue; }
        unitPrice = variant.priceToman;
      } else if (line.variantId) {
        unavailable.push({ menuItemId: item.id, variantId: line.variantId, reason: "VARIANT_UNAVAILABLE", name: item.name });
        continue;
      }
      if (unitPrice === null) { unavailable.push({ menuItemId: item.id, variantId: line.variantId ?? null, reason: "PRICE_UNAVAILABLE", name: item.name }); continue; }
      const result = this.promotionPricing.price(pricingContext, item.id, item.category.id, unitPrice);
      for (let unitIndex = 0; unitIndex < line.quantity; unitIndex++) units.push({
        key: `${item.id}:${variant?.id ?? ""}:${unitIndex}`, menuItemId: item.id, categoryId: item.category.id, variantId: variant?.id ?? null,
        itemName: item.name, variantName: variant?.name ?? null, unitIndex, originalPriceToman: result.originalPriceToman,
        unitPriceToman: result.finalPriceToman, discountAmountToman: result.discountAmountToman, promotion: result.promotion,
        promotionTypeSnapshot: null, promotionAllocationTypeSnapshot: null, promotionRuleSnapshot: null,
      });
    }

    if (unavailable.length) throw new ConflictException({ code: "ORDER_ITEM_UNAVAILABLE", message: "Some cart items are no longer available", items: unavailable });
    const allocated = this.promotionPricing.priceCart(pricingContext, units, supplementalPromotions);
    const rows = new Map<string, Pick<OrderItem, "menuItemId" | "menuItemVariantId" | "itemName" | "variantName" | "categoryIdSnapshot" | "categoryNameSnapshot" | "unitPriceToman" | "originalUnitPriceToman" | "discountAmountToman" | "promotionIdSnapshot" | "promotionNameSnapshot" | "promotionRewardTypeSnapshot" | "promotionRewardValueSnapshot" | "promotionTypeSnapshot" | "promotionAllocationTypeSnapshot" | "promotionRuleSnapshot" | "quantity" | "lineTotalToman">>();
    for (const unit of allocated) {
      const promotion = unit.promotion;
      const key = [unit.menuItemId, unit.variantId ?? "", unit.originalPriceToman, unit.unitPriceToman, promotion?.id ?? "", unit.promotionTypeSnapshot ?? "", unit.promotionAllocationTypeSnapshot ?? "", unit.promotionRuleSnapshot ?? ""].join(":");
      const current = rows.get(key);
      const quantity = (current?.quantity ?? 0) + 1;
      rows.set(key, {
        menuItemId: unit.menuItemId, menuItemVariantId: unit.variantId, itemName: unit.itemName, variantName: unit.variantName,
        categoryIdSnapshot: unit.categoryId, categoryNameSnapshot: (itemById.get(unit.menuItemId)?.category.name ?? null),
        unitPriceToman: unit.unitPriceToman, originalUnitPriceToman: unit.originalPriceToman, discountAmountToman: unit.discountAmountToman,
        promotionIdSnapshot: promotion?.id ?? null, promotionNameSnapshot: promotion?.name ?? null,
        promotionRewardTypeSnapshot: promotion?.rewardType ?? null, promotionRewardValueSnapshot: promotion?.rewardValue ?? null,
        promotionTypeSnapshot: unit.promotionTypeSnapshot, promotionAllocationTypeSnapshot: unit.promotionAllocationTypeSnapshot, promotionRuleSnapshot: unit.promotionRuleSnapshot,
        quantity, lineTotalToman: (BigInt(unit.unitPriceToman) * BigInt(quantity)).toString(),
      });
    }
    return [...rows.values()].sort((a, b) => (a.menuItemId ?? "").localeCompare(b.menuItemId ?? "") || (a.menuItemVariantId ?? "").localeCompare(b.menuItemVariantId ?? "") || a.unitPriceToman.localeCompare(b.unitPriceToman));
  }

  private nextStatuses(order: Order) {
    return nextOrderStatuses(order.status, order.deliveryMethod);
  }

  private notificationType(order: Order) {
    if (order.status === OrderStatus.Preparing) return NotificationType.OrderConfirmed;
    if (order.status === OrderStatus.Ready && order.deliveryMethod === OrderDeliveryMethod.Pickup) return NotificationType.OrderReadyOnSite;
    if (order.status === OrderStatus.OutForDelivery && order.deliveryMethod === OrderDeliveryMethod.Courier) return NotificationType.OrderReadyDelivery;
    if (order.status === OrderStatus.Delivered) return NotificationType.OrderCompleted;
    if (order.status === OrderStatus.Canceled) return NotificationType.OrderCancelled;
    return null;
  }

  private summary(order: Order) {
    return {
      id: order.id,
      status: order.status,
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      totalAmountToman: order.totalAmountToman,
      subtotalBeforeDiscountToman: order.subtotalBeforeDiscountToman,
      discountTotalToman: order.discountTotalToman,
      itemDiscountTotalToman: (BigInt(order.discountTotalToman ?? "0") - BigInt(order.orderDiscountToman ?? "0")).toString(),
      orderDiscountToman: order.orderDiscountToman ?? "0", orderPromotionName: order.orderPromotionNameSnapshot ?? null, couponCode: order.couponCodeSnapshot ?? null,
      client: order.client ? { id: order.client.id, firstName: order.client.firstName, lastName: order.client.lastName, phone: order.client.phone } : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private clientSummary(order: Order) {
    return {
      id: order.id,
      status: order.status,
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      totalAmountToman: order.totalAmountToman,
      subtotalBeforeDiscountToman: order.subtotalBeforeDiscountToman,
      discountTotalToman: order.discountTotalToman,
      itemDiscountTotalToman: (BigInt(order.discountTotalToman ?? "0") - BigInt(order.orderDiscountToman ?? "0")).toString(),
      orderDiscountToman: order.orderDiscountToman ?? "0", orderPromotionName: order.orderPromotionNameSnapshot ?? null, couponCode: order.couponCodeSnapshot ?? null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private orderItems(order: Order) {
    return [...(order.items ?? [])].sort((a, b) => a.itemName.localeCompare(b.itemName, "fa")).map((item) => ({
      id: item.id,
      menuItemId: item.menuItemId,
      variantId: item.menuItemVariantId,
      itemName: item.itemName,
      variantName: item.variantName,
      unitPriceToman: item.unitPriceToman,
      originalUnitPriceToman: item.originalUnitPriceToman,
      discountAmountToman: item.discountAmountToman,
      promotionName: item.promotionNameSnapshot,
      promotionType: item.promotionTypeSnapshot,
      allocationType: item.promotionAllocationTypeSnapshot,
      ruleSummary: item.promotionRuleSnapshot,
      quantity: item.quantity,
      lineTotalToman: item.lineTotalToman,
    }));
  }

  private clientProject(order: Order) {
    return {
      ...this.clientSummary(order),
      deliveryAddressSnapshot: order.deliveryAddressSnapshot,
      customerNote: order.customerNote,
      statusChangedAt: order.statusChangedAt,
      items: this.orderItems(order),
    };
  }

  private adminProject(order: Order) {
    return {
      ...this.summary(order),
      deliveryAddressSnapshot: order.deliveryAddressSnapshot,
      customerNote: order.customerNote,
      statusChangedAt: order.statusChangedAt,
      items: this.orderItems(order),
      nextStatuses: this.nextStatuses(order),
    };
  }
}
