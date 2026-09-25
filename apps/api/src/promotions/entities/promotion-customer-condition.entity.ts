import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { Promotion } from "./promotion.entity";

export enum PromotionCustomerConditionType {
  FirstOrder = "FIRST_ORDER",
  OrderCount = "ORDER_COUNT",
  TotalSpent = "TOTAL_SPENT",
  LastOrderAge = "LAST_ORDER_AGE",
  RegistrationAge = "REGISTRATION_AGE",
  CustomerSegment = "CUSTOMER_SEGMENT",
}

export enum PromotionCustomerConditionOperator {
  AtLeast = "AT_LEAST",
  AtMost = "AT_MOST",
  Exactly = "EXACTLY",
  WithinLast = "WITHIN_LAST",
}

@Entity({ name: "promotion_customer_conditions" })
@Index("UQ_promotion_customer_conditions_type", ["coffeeShopId", "promotionId", "type"], { unique: true })
@Index("IDX_promotion_customer_conditions_segment", ["coffeeShopId", "customerSegmentId"], { where: '"customer_segment_id" IS NOT NULL' })
export class PromotionCustomerCondition {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ name: "condition_type", type: "enum", enum: PromotionCustomerConditionType, enumName: "promotion_customer_condition_type" }) type!: PromotionCustomerConditionType;
  @Column({ type: "enum", enum: PromotionCustomerConditionOperator, enumName: "promotion_customer_condition_operator", nullable: true }) operator!: PromotionCustomerConditionOperator | null;
  @Column({ type: "bigint", nullable: true }) value!: string | null;
  @Column({ name: "customer_segment_id", type: "uuid", nullable: true }) customerSegmentId!: string | null;
  customerSegmentName?: string | null;

  @ManyToOne(() => Promotion, (promotion) => promotion.customerConditions, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "promotion_id", referencedColumnName: "id" }])
  promotion!: Promotion;
}
