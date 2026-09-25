import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany, OneToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Promotion } from "./promotion.entity";
import type { PromotionRewardType } from "./promotion.entity";

export enum AdvancedPromotionType {
  BuyXGetY = "BUY_X_GET_Y",
  Bundle = "BUNDLE",
  QuantityTier = "QUANTITY_TIER",
}

export enum PromotionRuleGroupRole {
  Buy = "BUY",
  Get = "GET",
  BundleItem = "BUNDLE_ITEM",
  QuantityTarget = "QUANTITY_TARGET",
}

@Entity({ name: "promotion_advanced_rules" })
@Unique("UQ_promotion_advanced_rules_promotion", ["coffeeShopId", "promotionId"])
@Unique("UQ_promotion_advanced_rules_tenant_id", ["coffeeShopId", "id"])
export class PromotionAdvancedRule {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ name: "rule_type", type: "enum", enum: AdvancedPromotionType, enumName: "promotion_advanced_type" }) type!: AdvancedPromotionType;
  @Column({ type: "boolean", default: true }) repeatable!: boolean;
  @OneToOne(() => Promotion, (promotion) => promotion.advancedRule, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "promotion_id", referencedColumnName: "id" }])
  promotion!: Promotion;
  @OneToMany(() => PromotionRuleGroup, (group) => group.rule) groups!: PromotionRuleGroup[];
  @OneToMany(() => PromotionQuantityTier, (tier) => tier.rule) tiers!: PromotionQuantityTier[];
}

@Entity({ name: "promotion_rule_groups" })
@Index("UQ_promotion_rule_groups_role", ["ruleId", "role", "position"], { unique: true })
@Unique("UQ_promotion_rule_groups_tenant_id", ["coffeeShopId", "id"])
@Check("CK_promotion_rule_groups_quantity", "quantity > 0")
export class PromotionRuleGroup {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "rule_id", type: "uuid" }) ruleId!: string;
  @Column({ type: "enum", enum: PromotionRuleGroupRole, enumName: "promotion_rule_group_role" }) role!: PromotionRuleGroupRole;
  @Column({ type: "smallint", default: 0 }) position!: number;
  @Column({ type: "smallint" }) quantity!: number;
  @ManyToOne(() => PromotionAdvancedRule, (rule) => rule.groups, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "rule_id", referencedColumnName: "id" }])
  rule!: PromotionAdvancedRule;
  @OneToMany(() => PromotionRuleTarget, (target) => target.group) targets!: PromotionRuleTarget[];
}

@Entity({ name: "promotion_rule_targets" })
@Unique("UQ_promotion_rule_targets_product", ["groupId", "menuItemId"])
@Unique("UQ_promotion_rule_targets_category", ["groupId", "categoryId"])
@Index("IDX_promotion_rule_targets_tenant_product", ["coffeeShopId", "menuItemId"])
@Index("IDX_promotion_rule_targets_tenant_category", ["coffeeShopId", "categoryId"])
@Check("CK_promotion_rule_targets_one_target", "(menu_item_id IS NOT NULL) <> (category_id IS NOT NULL)")
export class PromotionRuleTarget {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "group_id", type: "uuid" }) groupId!: string;
  @Column({ name: "menu_item_id", type: "uuid", nullable: true }) menuItemId!: string | null;
  @Column({ name: "category_id", type: "uuid", nullable: true }) categoryId!: string | null;
  @ManyToOne(() => PromotionRuleGroup, (group) => group.targets, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "group_id", referencedColumnName: "id" }])
  group!: PromotionRuleGroup;
}

@Entity({ name: "promotion_quantity_tiers" })
@Index("UQ_promotion_quantity_tiers_threshold", ["ruleId", "minimumQuantity"], { unique: true })
@Check("CK_promotion_quantity_tiers_threshold", "minimum_quantity > 0")
@Check("CK_promotion_quantity_tiers_reward", "(reward_type = 'PERCENTAGE' AND reward_value BETWEEN 1 AND 100) OR (reward_type = 'FIXED_AMOUNT' AND reward_value > 0)")
export class PromotionQuantityTier {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "rule_id", type: "uuid" }) ruleId!: string;
  @Column({ name: "minimum_quantity", type: "smallint" }) minimumQuantity!: number;
  @Column({ name: "reward_type", type: "enum", enum: ["PERCENTAGE", "FIXED_AMOUNT"], enumName: "promotion_reward_type" }) rewardType!: PromotionRewardType.Percentage | PromotionRewardType.FixedAmount;
  @Column({ name: "reward_value", type: "bigint" }) rewardValue!: string;
  @ManyToOne(() => PromotionAdvancedRule, (rule) => rule.tiers, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "rule_id", referencedColumnName: "id" }])
  rule!: PromotionAdvancedRule;
}
