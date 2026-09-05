import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { MenuItem } from "./menu-item.entity";

@Entity({ name: "menu_categories" })
@Unique("UQ_menu_categories_tenant_name", ["coffeeShopId", "name"])
@Index("IDX_menu_categories_tenant_order", ["coffeeShopId", "sortOrder"])
export class MenuCategory {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 100 }) name!: string;
  @Column({ type: "varchar", length: 240, nullable: true }) description!: string | null;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true }) deletedAt!: Date | null;
  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" }) @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @OneToMany(() => MenuItem, (item) => item.category) items!: MenuItem[];
}
