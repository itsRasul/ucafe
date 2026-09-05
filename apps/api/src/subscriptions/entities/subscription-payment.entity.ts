import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { User } from "../../identity/entities";
import { Subscription } from "./subscription.entity";

export enum SubscriptionPaymentStatus {
  Paid = "PAID",
  Refunded = "REFUNDED",
}

@Entity({ name: "subscription_payments" })
@Index("UQ_subscription_payments_provider_reference", ["provider", "providerReference"], { unique: true, where: "provider_reference IS NOT NULL" })
export class SubscriptionPayment {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "subscription_id", type: "uuid" })
  subscriptionId!: string;

  @Column({ type: "enum", enum: SubscriptionPaymentStatus, enumName: "subscription_payment_status", default: SubscriptionPaymentStatus.Paid })
  status!: SubscriptionPaymentStatus;

  @Column({ name: "amount_toman", type: "bigint" })
  amountToman!: string;

  @Column({ name: "plan_key_snapshot", type: "varchar", length: 40 })
  planKeySnapshot!: string;

  @Column({ name: "plan_name_snapshot", type: "varchar", length: 100 })
  planNameSnapshot!: string;

  @Column({ name: "period_started_at", type: "timestamptz" })
  periodStartedAt!: Date;

  @Column({ name: "period_ends_at", type: "timestamptz" })
  periodEndsAt!: Date;

  @Column({ type: "varchar", length: 40, nullable: true })
  provider!: string | null;

  @Column({ name: "provider_reference", type: "varchar", length: 160, nullable: true })
  providerReference!: string | null;

  @Column({ name: "recorded_by_user_id", type: "uuid", nullable: true })
  recordedByUserId!: string | null;

  @Column({ name: "paid_at", type: "timestamptz" })
  paidAt!: Date;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @ManyToOne(() => Subscription, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "subscription_id" })
  subscription!: Subscription;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "recorded_by_user_id" })
  recordedByUser!: User | null;
}
