import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { MenuCategory } from "./menu-category.entity";
import { MenuItemVariant } from "./menu-item-variant.entity";

@Entity({ name: "menu_items" })
@Index("IDX_menu_items_tenant_category_order", ["coffeeShopId", "categoryId", "sortOrder"])
export class MenuItem {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "category_id", type: "uuid" }) categoryId!: string;
  @Column({ type: "varchar", length: 140 }) name!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ name: "base_price_toman", type: "bigint", nullable: true }) basePriceToman!: string | null;
  @Column({ name: "is_available", type: "boolean", default: true }) isAvailable!: boolean;
  @Column({ name: "is_featured", type: "boolean", default: false }) isFeatured!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" }) @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @ManyToOne(() => MenuCategory, (category) => category.items, { onDelete: "RESTRICT" }) @JoinColumn({ name: "category_id" }) category!: MenuCategory;
  @OneToMany(() => MenuItemVariant, (variant) => variant.item) variants!: MenuItemVariant[];
}
