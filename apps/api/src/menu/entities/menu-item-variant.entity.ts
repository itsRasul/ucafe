import { Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { MenuItem } from "./menu-item.entity";

@Entity({ name: "menu_item_variants" })
@Unique("UQ_menu_item_variants_item_name", ["itemId", "name"])
@Index("IDX_menu_item_variants_tenant_item_order", ["coffeeShopId", "itemId", "sortOrder"])
export class MenuItemVariant {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ type: "varchar", length: 80 }) name!: string;
  @Column({ name: "price_toman", type: "bigint" }) priceToman!: string;
  @Column({ name: "is_default", type: "boolean", default: false }) isDefault!: boolean;
  @Column({ name: "is_available", type: "boolean", default: true }) isAvailable!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" }) @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @ManyToOne(() => MenuItem, (item) => item.variants, { onDelete: "CASCADE" }) @JoinColumn({ name: "item_id" }) item!: MenuItem;
}
