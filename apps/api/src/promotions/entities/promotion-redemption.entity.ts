import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum RedemptionStatus { Applied = "APPLIED", Released = "RELEASED" }

@Entity({ name: "promotion_redemptions" })
@Index("UQ_promotion_redemptions_order", ["orderId"], { unique: true })
@Index("IDX_promotion_redemptions_coupon_status", ["couponId", "status"])
@Index("IDX_promotion_redemptions_customer_status", ["couponId", "customerId", "status"])
export class PromotionRedemption {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ name: "coupon_id", type: "uuid" }) couponId!: string;
  @Column({ name: "customer_id", type: "uuid" }) customerId!: string;
  @Column({ name: "order_id", type: "uuid" }) orderId!: string;
  @Column({ name: "discount_amount_toman", type: "bigint" }) discountAmountToman!: string;
  @Column({ type: "enum", enum: RedemptionStatus, enumName: "promotion_redemption_status" }) status!: RedemptionStatus;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
