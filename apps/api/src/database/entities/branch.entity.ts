import { Check, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "./coffee-shop.entity";

@Entity({ name: "branches" })
@Unique("UQ_branches_tenant_slug", ["coffeeShopId", "slug"])
@Check("CK_branches_slug", `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
@Index("UQ_branches_primary_per_tenant", ["coffeeShopId"], { unique: true, where: "is_primary = true AND deleted_at IS NULL" })
export class Branch {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 63, default: "main" })
  slug!: string;

  @Column({ name: "is_primary", type: "boolean", default: false })
  isPrimary!: boolean;

  @Column({ type: "varchar", length: 32, nullable: true })
  phone!: string | null;

  @Column({ type: "text", nullable: true })
  address!: string | null;

  @Column({ type: "numeric", precision: 9, scale: 6, nullable: true })
  latitude!: string | null;

  @Column({ type: "numeric", precision: 9, scale: 6, nullable: true })
  longitude!: string | null;

  @Column({ type: "varchar", length: 64, default: "Asia/Tehran" })
  timezone!: string;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => CoffeeShop, (coffeeShop) => coffeeShop.branches, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;
}
