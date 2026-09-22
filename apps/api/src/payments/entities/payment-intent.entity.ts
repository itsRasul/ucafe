import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { SubscriptionOperation, SubscriptionPlan } from "../../subscriptions/entities";

export enum PaymentIntentStatus { Pending = "PENDING", Verifying = "VERIFYING", Paid = "PAID", Failed = "FAILED", Expired = "EXPIRED", Canceled = "CANCELED" }

@Entity({ name: "payment_intents" })
export class PaymentIntent {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "plan_id", type: "uuid" }) planId!: string;
  @Column({ name: "plan_key_snapshot", type: "varchar", length: 40 }) planKeySnapshot!: string;
  @Column({ name: "plan_name_snapshot", type: "varchar", length: 100 }) planNameSnapshot!: string;
  @Column({ name: "plan_price_snapshot", type: "bigint" }) planPriceSnapshot!: string;
  @Column({ name: "billing_months_snapshot", type: "smallint" }) billingMonthsSnapshot!: number;
  @Column({ name: "source_plan_key_snapshot", type: "varchar", length: 40, nullable: true }) sourcePlanKeySnapshot!: string | null;
  @Column({ name: "source_plan_name_snapshot", type: "varchar", length: 100, nullable: true }) sourcePlanNameSnapshot!: string | null;
  @Column({ name: "source_plan_price_snapshot", type: "bigint", nullable: true }) sourcePlanPriceSnapshot!: string | null;
  @Column({ name: "source_billing_months_snapshot", type: "smallint", nullable: true }) sourceBillingMonthsSnapshot!: number | null;
  @Column({ type: "enum", enum: SubscriptionOperation, enumName: "subscription_operation" }) operation!: SubscriptionOperation;
  @Column({ name: "amount_toman", type: "bigint" }) amountToman!: string;
  @Column({ name: "pricing_snapshot", type: "jsonb", default: () => "'{}'::jsonb" }) pricingSnapshot!: Record<string, unknown>;
  @Column({ name: "subscription_version_snapshot", type: "integer", nullable: true }) subscriptionVersionSnapshot!: number | null;
  @Column({ name: "period_started_at", type: "timestamptz", nullable: true }) periodStartedAt!: Date | null;
  @Column({ name: "period_ends_at", type: "timestamptz", nullable: true }) periodEndsAt!: Date | null;
  @Column({ name: "effective_timing", type: "varchar", length: 32 }) effectiveTiming!: string;
  @Column({ type: "varchar", length: 40 }) provider!: string;
  @Column({ type: "varchar", length: 160, nullable: true, unique: true }) authority!: string | null;
  @Column({ name: "idempotency_key", type: "varchar", length: 80 }) idempotencyKey!: string;
  @Column({ type: "enum", enum: PaymentIntentStatus, enumName: "payment_intent_status", default: PaymentIntentStatus.Pending }) status!: PaymentIntentStatus;
  @Column({ name: "provider_reference", type: "varchar", length: 160, nullable: true }) providerReference!: string | null;
  @Column({ name: "expires_at", type: "timestamptz" }) expiresAt!: Date;
  @Column({ name: "paid_at", type: "timestamptz", nullable: true }) paidAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @ManyToOne(() => CoffeeShop, { onDelete: "CASCADE" }) @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @ManyToOne(() => SubscriptionPlan, { onDelete: "RESTRICT" }) @JoinColumn({ name: "plan_id" }) plan!: SubscriptionPlan;
}
