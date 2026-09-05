import { Column, CreateDateColumn, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { SubscriptionPlan } from "./subscription-plan.entity";

export enum SubscriptionStatus {
  Trialing = "TRIALING",
  Active = "ACTIVE",
  Grace = "GRACE",
  Suspended = "SUSPENDED",
  Canceled = "CANCELED",
}

@Entity({ name: "subscriptions" })
@Unique("UQ_subscriptions_coffee_shop", ["coffeeShopId"])
export class Subscription {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "plan_id", type: "uuid" })
  planId!: string;

  @Column({ type: "enum", enum: SubscriptionStatus, enumName: "subscription_status" })
  status!: SubscriptionStatus;

  @Column({ name: "trial_started_at", type: "timestamptz", nullable: true })
  trialStartedAt!: Date | null;

  @Column({ name: "trial_ends_at", type: "timestamptz", nullable: true })
  trialEndsAt!: Date | null;

  @Column({ name: "current_period_started_at", type: "timestamptz", nullable: true })
  currentPeriodStartedAt!: Date | null;

  @Column({ name: "current_period_ends_at", type: "timestamptz", nullable: true })
  currentPeriodEndsAt!: Date | null;

  @Column({ name: "grace_ends_at", type: "timestamptz", nullable: true })
  graceEndsAt!: Date | null;

  @Column({ name: "suspended_at", type: "timestamptz", nullable: true })
  suspendedAt!: Date | null;

  @Column({ name: "canceled_at", type: "timestamptz", nullable: true })
  canceledAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => SubscriptionPlan, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "plan_id" })
  plan!: SubscriptionPlan;
}
