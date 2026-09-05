import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum PlanStatus {
  Active = "ACTIVE",
  Postponed = "POSTPONED",
  Archived = "ARCHIVED",
}

@Entity({ name: "subscription_plans" })
export class SubscriptionPlan {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 40, unique: true })
  key!: string;

  @Column({ type: "varchar", length: 100 })
  name!: string;

  @Column({ type: "enum", enum: PlanStatus, enumName: "subscription_plan_status" })
  status!: PlanStatus;

  @Column({ name: "price_toman", type: "bigint" })
  priceToman!: string;

  @Column({ name: "billing_months", type: "smallint", default: 1 })
  billingMonths!: number;

  @Column({ name: "trial_days", type: "smallint", default: 7 })
  trialDays!: number;

  @Column({ name: "grace_days", type: "smallint", default: 7 })
  graceDays!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  features!: Record<string, boolean>;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
