import { Column, CreateDateColumn, Entity, Index, JoinColumn, OneToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Promotion } from "./promotion.entity";

@Entity({ name: "promotion_coupons" })
@Index("UQ_promotion_coupons_tenant_code", ["coffeeShopId", "normalizedCode"], { unique: true })
@Index("UQ_promotion_coupons_promotion", ["promotionId"], { unique: true })
export class PromotionCoupon {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ type: "varchar", length: 64 }) code!: string;
  @Column({ name: "normalized_code", type: "varchar", length: 64 }) normalizedCode!: string;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @Column({ name: "starts_at", type: "timestamptz", nullable: true }) startsAt!: Date | null;
  @Column({ name: "expires_at", type: "timestamptz", nullable: true }) expiresAt!: Date | null;
  @Column({ name: "total_usage_limit", type: "integer", nullable: true }) totalUsageLimit!: number | null;
  @Column({ name: "per_customer_usage_limit", type: "integer", nullable: true }) perCustomerUsageLimit!: number | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @OneToOne(() => Promotion, (promotion) => promotion.coupon, { onDelete: "RESTRICT" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "promotion_id", referencedColumnName: "id" }]) promotion!: Promotion;
}
