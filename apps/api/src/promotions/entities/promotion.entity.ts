import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, OneToMany, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { PromotionTarget } from "./promotion-target.entity";
import { PromotionCoupon } from "./promotion-coupon.entity";
import { PromotionScheduleWindow } from "./promotion-schedule-window.entity";
import { PromotionAdvancedRule } from "./promotion-advanced-rule.entity";

export enum PromotionRewardType {
  Percentage = "PERCENTAGE",
  FixedAmount = "FIXED_AMOUNT",
  FixedPrice = "FIXED_PRICE",
}

@Entity({ name: "promotions" })
@Index("UQ_promotions_tenant_id", ["coffeeShopId", "id"], { unique: true })
@Index("IDX_promotions_tenant_active_window", ["coffeeShopId", "isActive", "startAt", "endAt"])
export class Promotion {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 120 }) name!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ name: "is_active", type: "boolean", default: false }) isActive!: boolean;
  @Column({ name: "start_at", type: "timestamptz", nullable: true }) startAt!: Date | null;
  @Column({ name: "end_at", type: "timestamptz", nullable: true }) endAt!: Date | null;
  @Column({ type: "integer", default: 0 }) priority!: number;
  @Column({ name: "reward_type", type: "enum", enum: PromotionRewardType, enumName: "promotion_reward_type" }) rewardType!: PromotionRewardType;
  @Column({ name: "reward_value", type: "bigint" }) rewardValue!: string;
  @Column({ name: "entire_order", type: "boolean", default: false }) entireOrder!: boolean;
  @Column({ name: "minimum_subtotal_toman", type: "bigint", nullable: true }) minimumSubtotalToman!: string | null;
  @Column({ name: "max_discount_toman", type: "bigint", nullable: true }) maxDiscountToman!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true }) deletedAt!: Date | null;
  @OneToMany(() => PromotionTarget, (target) => target.promotion) targets!: PromotionTarget[];
  @OneToOne(() => PromotionCoupon, (coupon) => coupon.promotion) coupon!: PromotionCoupon | null;
  @OneToMany(() => PromotionScheduleWindow, (window) => window.promotion) scheduleWindows!: PromotionScheduleWindow[];
  @OneToOne(() => PromotionAdvancedRule, (rule) => rule.promotion) advancedRule!: PromotionAdvancedRule | null;
}
