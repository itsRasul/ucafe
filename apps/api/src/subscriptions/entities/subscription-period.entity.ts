import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { SubscriptionPlan } from "./subscription-plan.entity";
import { Subscription } from "./subscription.entity";
import { SubscriptionPayment } from "./subscription-payment.entity";

@Entity({ name: "subscription_periods" })
@Check("CK_subscription_periods_range", "ends_at > starts_at")
@Index("IDX_subscription_periods_subscription_range", ["subscriptionId", "startsAt", "endsAt"])
export class SubscriptionPeriod {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "subscription_id", type: "uuid" }) subscriptionId!: string;
  @Column({ name: "plan_id", type: "uuid" }) planId!: string;
  @Column({ name: "payment_id", type: "uuid", nullable: true, unique: true }) paymentId!: string | null;
  @Column({ name: "starts_at", type: "timestamptz" }) startsAt!: Date;
  @Column({ name: "ends_at", type: "timestamptz" }) endsAt!: Date;
  @Column({ name: "price_basis_toman", type: "bigint" }) priceBasisToman!: string;
  @Column({ name: "billing_months_basis", type: "smallint" }) billingMonthsBasis!: number;
  @ManyToOne(() => Subscription, { onDelete: "RESTRICT" }) @JoinColumn({ name: "subscription_id" }) subscription!: Subscription;
  @ManyToOne(() => SubscriptionPlan, { onDelete: "RESTRICT" }) @JoinColumn({ name: "plan_id" }) plan!: SubscriptionPlan;
  @ManyToOne(() => SubscriptionPayment, { nullable: true, onDelete: "RESTRICT" }) @JoinColumn({ name: "payment_id" }) payment!: SubscriptionPayment | null;
}
