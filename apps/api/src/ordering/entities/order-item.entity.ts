import { Check, Column, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { MenuItem, MenuItemVariant } from "../../menu/entities";
import { Order } from "./order.entity";

@Entity({ name: "order_items" })
@Index("IDX_order_items_order", ["orderId"])
@Check("CK_order_items_quantity", "quantity > 0")
@Check("CK_order_items_amounts", "unit_price_toman >= 0 AND line_total_toman >= 0")
export class OrderItem {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "order_id", type: "uuid" })
  orderId!: string;

  @Column({ name: "menu_item_id", type: "uuid", nullable: true })
  menuItemId!: string | null;

  @Column({ name: "menu_item_variant_id", type: "uuid", nullable: true })
  menuItemVariantId!: string | null;

  @Column({ name: "item_name", type: "varchar", length: 140 })
  itemName!: string;

  @Column({ name: "variant_name", type: "varchar", length: 80, nullable: true })
  variantName!: string | null;

  @Column({ name: "unit_price_toman", type: "bigint" })
  unitPriceToman!: string;

  @Column({ type: "smallint" })
  quantity!: number;

  @Column({ name: "line_total_toman", type: "bigint" })
  lineTotalToman!: string;

  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: "CASCADE" })
  @JoinColumn({ name: "order_id" })
  order!: Order;

  @ManyToOne(() => MenuItem, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "menu_item_id" })
  menuItem!: MenuItem | null;

  @ManyToOne(() => MenuItemVariant, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "menu_item_variant_id" })
  menuItemVariant!: MenuItemVariant | null;
}
