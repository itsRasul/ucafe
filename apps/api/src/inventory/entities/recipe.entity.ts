import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum RecipeVersionStatus { Draft = "DRAFT", Active = "ACTIVE", Superseded = "SUPERSEDED" }

@Entity("inventory_recipes")
@Index("UQ_inventory_recipes_item_target", ["coffeeShopId", "menuItemId"], { unique: true, where: '"menu_item_variant_id" IS NULL' })
@Index("UQ_inventory_recipes_variant_target", ["coffeeShopId", "menuItemVariantId"], { unique: true, where: '"menu_item_variant_id" IS NOT NULL' })
export class InventoryRecipe {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "menu_item_id", type: "uuid" }) menuItemId!: string;
  @Column({ name: "menu_item_variant_id", type: "uuid", nullable: true }) menuItemVariantId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_recipe_versions")
@Index("UQ_inventory_recipe_versions_number", ["coffeeShopId", "recipeId", "versionNumber"], { unique: true })
@Index("UQ_inventory_recipe_versions_active", ["coffeeShopId", "recipeId"], { unique: true, where: '"status" = \'ACTIVE\'' })
@Index("UQ_inventory_recipe_versions_draft", ["coffeeShopId", "recipeId"], { unique: true, where: '"status" = \'DRAFT\'' })
export class InventoryRecipeVersion {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "recipe_id", type: "uuid" }) recipeId!: string;
  @Column({ name: "version_number", type: "integer" }) versionNumber!: number;
  @Column({ type: "enum", enum: RecipeVersionStatus, enumName: "inventory_recipe_version_status" }) status!: RecipeVersionStatus;
  @Column({ name: "revision", type: "integer", default: 0 }) revision!: number;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "published_by_user_id", type: "uuid", nullable: true }) publishedByUserId!: string | null;
  @Column({ name: "effective_from", type: "timestamptz", nullable: true }) effectiveFrom!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_recipe_components")
@Index("UQ_inventory_recipe_components_item", ["coffeeShopId", "recipeVersionId", "inventoryItemId"], { unique: true })
export class InventoryRecipeComponent {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "recipe_version_id", type: "uuid" }) recipeVersionId!: string;
  @Column({ name: "inventory_item_id", type: "uuid" }) inventoryItemId!: string;
  @Column({ name: "inventory_item_name_snapshot", type: "varchar", length: 140 }) inventoryItemNameSnapshot!: string;
  @Column({ name: "quantity_display", type: "numeric", precision: 20, scale: 6 }) quantityDisplay!: string;
  @Column({ name: "unit", type: "varchar", length: 16 }) unit!: string;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6 }) quantityBase!: string;
  @Column({ type: "varchar", length: 240, nullable: true }) note!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
