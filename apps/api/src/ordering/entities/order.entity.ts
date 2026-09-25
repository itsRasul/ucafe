import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { Client, ClientAddress } from "../../clients/entities";
import { CoffeeShop, Branch } from "../../database/entities";
import { User } from "../../identity/entities";
import { OrderItem } from "./order-item.entity";

export enum OrderStatus {
  UnderReview = "UNDER_REVIEW",
  Preparing = "PREPARING",
  Ready = "READY",
  OutForDelivery = "OUT_FOR_DELIVERY",
  Delivered = "DELIVERED",
  Canceled = "CANCELED",
}

export enum OrderPaymentMethod {
  Offline = "OFFLINE",
}

export enum OrderDeliveryMethod {
  Pickup = "PICKUP",
  Courier = "COURIER",
}

export enum OrderSource {
  PublicClient = "PUBLIC_CLIENT",
}

@Entity({ name: "orders" })
@Unique("UQ_orders_client_idempotency", ["coffeeShopId", "clientId", "idempotencyKey"])
@Index("IDX_orders_tenant_created", ["coffeeShopId", "createdAt"])
@Index("IDX_orders_tenant_status_created", ["coffeeShopId", "status", "createdAt"])
@Index("IDX_orders_tenant_status_changed", ["coffeeShopId", "status", "statusChangedAt"])
@Index("IDX_orders_tenant_status_client_changed", ["coffeeShopId", "status", "clientId", "statusChangedAt"])
export class Order {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "client_id", type: "uuid" })
  clientId!: string;

  @Column({ name: "branch_id", type: "uuid", nullable: true })
  branchId!: string | null;

  @Column({ type: "enum", enum: OrderStatus, enumName: "order_status", default: OrderStatus.UnderReview })
  status!: OrderStatus;

  @Column({ name: "payment_method", type: "enum", enum: OrderPaymentMethod, enumName: "order_payment_method", default: OrderPaymentMethod.Offline })
  paymentMethod!: OrderPaymentMethod;

  @Column({ name: "delivery_method", type: "enum", enum: OrderDeliveryMethod, enumName: "order_delivery_method" })
  deliveryMethod!: OrderDeliveryMethod;

  @Column({ name: "order_source", type: "enum", enum: OrderSource, enumName: "order_source", nullable: true })
  orderSource!: OrderSource | null;

  @Column({ name: "delivery_address_id", type: "uuid", nullable: true })
  deliveryAddressId!: string | null;

  @Column({ name: "delivery_address_snapshot", type: "jsonb", nullable: true })
  deliveryAddressSnapshot!: { label: string | null; province: string | null; city: string | null; addressLine: string; buildingNumber: string | null; unit: string | null; postalCode: string | null } | null;

  @Column({ name: "total_amount_toman", type: "bigint" })
  totalAmountToman!: string;

  @Column({ name: "subtotal_before_discount_toman", type: "bigint", default: 0 })
  subtotalBeforeDiscountToman!: string;

  @Column({ name: "discount_total_toman", type: "bigint", default: 0 })
  discountTotalToman!: string;

  @Column({ name: "order_discount_toman", type: "bigint", default: 0 }) orderDiscountToman!: string;
  @Column({ name: "order_promotion_id_snapshot", type: "uuid", nullable: true }) orderPromotionIdSnapshot!: string | null;
  @Column({ name: "order_promotion_name_snapshot", type: "varchar", length: 120, nullable: true }) orderPromotionNameSnapshot!: string | null;
  @Column({ name: "order_promotion_reward_type_snapshot", type: "varchar", length: 20, nullable: true }) orderPromotionRewardTypeSnapshot!: string | null;
  @Column({ name: "order_promotion_reward_value_snapshot", type: "bigint", nullable: true }) orderPromotionRewardValueSnapshot!: string | null;
  @Column({ name: "coupon_code_snapshot", type: "varchar", length: 64, nullable: true }) couponCodeSnapshot!: string | null;

  @Column({ name: "idempotency_key", type: "varchar", length: 80 })
  idempotencyKey!: string;

  @Column({ name: "customer_note", type: "varchar", length: 500, nullable: true })
  customerNote!: string | null;

  @Column({ name: "status_changed_at", type: "timestamptz", nullable: true })
  statusChangedAt!: Date | null;

  @Column({ name: "status_changed_by_user_id", type: "uuid", nullable: true })
  statusChangedByUserId!: string | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => Client, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "client_id" })
  client!: Client;

  @ManyToOne(() => Branch, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "branch_id" })
  branch!: Branch | null;

  @ManyToOne(() => ClientAddress, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "delivery_address_id" })
  deliveryAddress!: ClientAddress | null;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "status_changed_by_user_id" })
  statusChangedBy!: User | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items!: OrderItem[];
}
