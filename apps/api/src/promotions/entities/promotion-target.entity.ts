import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Promotion } from "./promotion.entity";

@Entity({ name: "promotion_targets" })
@Unique("UQ_promotion_targets_product", ["promotionId", "menuItemId"])
@Unique("UQ_promotion_targets_category", ["promotionId", "categoryId"])
@Index("IDX_promotion_targets_tenant_product", ["coffeeShopId", "menuItemId"])
@Index("IDX_promotion_targets_tenant_category", ["coffeeShopId", "categoryId"])
@Check("CK_promotion_targets_one_target", "(menu_item_id IS NOT NULL) <> (category_id IS NOT NULL)")
export class PromotionTarget {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ name: "menu_item_id", type: "uuid", nullable: true }) menuItemId!: string | null;
  @Column({ name: "category_id", type: "uuid", nullable: true }) categoryId!: string | null;
  @ManyToOne(() => Promotion, (promotion) => promotion.targets, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "promotion_id", referencedColumnName: "id" }])
  promotion!: Promotion;
}
