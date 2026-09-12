import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { Client, ClientAddress } from "../clients/entities";
import { Branch } from "../database/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { CheckoutAddressDto, CheckoutLineDto, CreateOrderDto, OrdersQueryDto, UpdateOnlineOrderingSettingsDto } from "./dto/ordering.dto";
import { OnlineOrderingSettings, Order, OrderDeliveryMethod, OrderItem, OrderPaymentMethod, OrderStatus } from "./entities";
import { nextOrderStatuses } from "./order-status.util";

type UnavailableLine = { menuItemId: string; variantId: string | null; reason: string; name?: string };

@Injectable()
export class OrderingService {
  constructor(private readonly dataSource: DataSource, private readonly subscriptions: SubscriptionsService) {}

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
    return this.dataSource.getRepository(OnlineOrderingSettings).save(settings);
  }

  async createOrder(coffeeShopId: string, clientId: string, input: CreateOrderDto) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`order:${coffeeShopId}:${clientId}:${input.idempotencyKey}`]);
      const existing = await manager.findOne(Order, { where: { coffeeShopId, clientId, idempotencyKey: input.idempotencyKey }, relations: { client: true, items: true } });
      if (existing) return this.project(existing);

      await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.OnlineOrdering);
      const settings = await manager.findOneBy(OnlineOrderingSettings, { coffeeShopId }) ?? await manager.save(OnlineOrderingSettings, manager.create(OnlineOrderingSettings, { coffeeShopId }));
      if (input.paymentMethod !== OrderPaymentMethod.Offline || !settings.offlinePaymentEnabled) throw new ForbiddenException({ code: "PAYMENT_METHOD_UNAVAILABLE", message: "Selected payment method is unavailable" });
      if (input.deliveryMethod === OrderDeliveryMethod.Pickup && !settings.pickupEnabled) throw new ForbiddenException({ code: "DELIVERY_METHOD_UNAVAILABLE", message: "Selected delivery method is unavailable" });
      if (input.deliveryMethod === OrderDeliveryMethod.Courier && !settings.courierEnabled) throw new ForbiddenException({ code: "DELIVERY_METHOD_UNAVAILABLE", message: "Selected delivery method is unavailable" });

      const client = await manager.findOneBy(Client, { id: clientId, coffeeShopId });
      if (!client) throw new NotFoundException("Client not found");

      const branch = await manager.findOneBy(Branch, { coffeeShopId, isPrimary: true, isActive: true });
      const address = input.deliveryMethod === OrderDeliveryMethod.Courier ? await this.resolveAddress(manager, coffeeShopId, clientId, input.addressId, input.newAddress) : null;
      const lines = await this.priceLines(manager, coffeeShopId, input.items);
      const total = lines.reduce((sum, line) => sum + BigInt(line.lineTotalToman), 0n);

      const order = await manager.save(Order, manager.create(Order, {
        coffeeShopId,
        clientId,
        branchId: branch?.id ?? null,
        status: OrderStatus.UnderReview,
        paymentMethod: input.paymentMethod,
        deliveryMethod: input.deliveryMethod,
        deliveryAddressId: address?.id ?? null,
        deliveryAddressSnapshot: address ? this.addressSnapshot(address) : null,
        totalAmountToman: total.toString(),
        idempotencyKey: input.idempotencyKey,
        customerNote: input.customerNote?.trim() || null,
      }));
      await manager.save(OrderItem, lines.map((line) => manager.create(OrderItem, { ...line, coffeeShopId, orderId: order.id })));
      const saved = await manager.findOneOrFail(Order, { where: { id: order.id }, relations: { client: true, items: true } });
      return this.project(saved);
    });
  }

  async clientDetail(coffeeShopId: string, clientId: string, id: string) {
    const order = await this.dataSource.getRepository(Order).findOne({ where: { id, coffeeShopId, clientId }, relations: { client: true, items: true } });
    if (!order) throw new NotFoundException("Order not found");
    return this.project(order);
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
    return this.project(order);
  }

  async updateStatus(coffeeShopId: string, id: string, actorUserId: string, next: OrderStatus) {
    return this.dataSource.transaction(async (manager) => {
      const order = await manager.getRepository(Order).createQueryBuilder("order").setLock("pessimistic_write").where("order.id = :id AND order.coffeeShopId = :coffeeShopId", { id, coffeeShopId }).getOne();
      if (!order) throw new NotFoundException("Order not found");
      if (!this.nextStatuses(order).includes(next)) throw new ConflictException("Invalid order status transition");
      order.status = next;
      order.statusChangedAt = new Date();
      order.statusChangedByUserId = actorUserId;
      await manager.save(order);
      const saved = await manager.findOneOrFail(Order, { where: { id, coffeeShopId }, relations: { client: true, items: true } });
      return this.project(saved);
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

  private async priceLines(manager: import("typeorm").EntityManager, coffeeShopId: string, input: CheckoutLineDto[]) {
    const merged = new Map<string, CheckoutLineDto>();
    for (const line of input) {
      const key = `${line.menuItemId}:${line.variantId ?? ""}`;
      const current = merged.get(key);
      merged.set(key, current ? { ...line, quantity: current.quantity + line.quantity } : { ...line });
    }
    const lines = [...merged.values()];
    if (!lines.length) throw new BadRequestException("Cart is empty");
    if (lines.reduce((sum, line) => sum + line.quantity, 0) > 50 || lines.some((line) => line.quantity < 1 || line.quantity > 20)) throw new BadRequestException("Invalid cart quantity");

    const items = await manager.find(MenuItem, { where: { id: In(lines.map((line) => line.menuItemId)), coffeeShopId, deletedAt: IsNull() }, relations: { variants: true, category: true } });
    const itemById = new Map(items.map((item) => [item.id, item]));
    const unavailable: UnavailableLine[] = [];
    const priced: Array<Pick<OrderItem, "menuItemId" | "menuItemVariantId" | "itemName" | "variantName" | "unitPriceToman" | "quantity" | "lineTotalToman">> = [];

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
      const lineTotal = BigInt(unitPrice) * BigInt(line.quantity);
      priced.push({ menuItemId: item.id, menuItemVariantId: variant?.id ?? null, itemName: item.name, variantName: variant?.name ?? null, unitPriceToman: unitPrice, quantity: line.quantity, lineTotalToman: lineTotal.toString() });
    }

    if (unavailable.length) throw new ConflictException({ code: "ORDER_ITEM_UNAVAILABLE", message: "Some cart items are no longer available", items: unavailable });
    return priced;
  }

  private nextStatuses(order: Order) {
    return nextOrderStatuses(order.status, order.deliveryMethod);
  }

  private summary(order: Order) {
    return {
      id: order.id,
      status: order.status,
      deliveryMethod: order.deliveryMethod,
      paymentMethod: order.paymentMethod,
      totalAmountToman: order.totalAmountToman,
      client: order.client ? { id: order.client.id, firstName: order.client.firstName, lastName: order.client.lastName, phone: order.client.phone } : null,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }

  private project(order: Order) {
    return {
      ...this.summary(order),
      deliveryAddressSnapshot: order.deliveryAddressSnapshot,
      customerNote: order.customerNote,
      statusChangedAt: order.statusChangedAt,
      items: [...(order.items ?? [])].sort((a, b) => a.itemName.localeCompare(b.itemName, "fa")).map((item) => ({
        id: item.id,
        menuItemId: item.menuItemId,
        variantId: item.menuItemVariantId,
        itemName: item.itemName,
        variantName: item.variantName,
        unitPriceToman: item.unitPriceToman,
        quantity: item.quantity,
        lineTotalToman: item.lineTotalToman,
      })),
      nextStatuses: this.nextStatuses(order),
    };
  }
}
