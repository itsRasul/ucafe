import { Check, Column, CreateDateColumn, DeleteDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { Branch } from "./branch.entity";
import { Domain } from "./domain.entity";

export enum CoffeeShopStatus {
  Draft = "DRAFT",
  Preview = "PREVIEW",
  Active = "ACTIVE",
  Suspended = "SUSPENDED",
  Archived = "ARCHIVED",
}

@Entity({ name: "coffee_shops" })
@Unique("UQ_coffee_shops_slug", ["slug"])
@Check("CK_coffee_shops_slug", `slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`)
export class CoffeeShop {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "varchar", length: 63 })
  slug!: string;

  @Column({ type: "enum", enum: CoffeeShopStatus, enumName: "coffee_shop_status", default: CoffeeShopStatus.Draft })
  status!: CoffeeShopStatus;

  @Column({ name: "default_locale", type: "varchar", length: 16, default: "fa-IR" })
  defaultLocale!: string;

  @Column({ type: "varchar", length: 64, default: "Asia/Tehran" })
  timezone!: string;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "suspended_at", type: "timestamptz", nullable: true })
  suspendedAt!: Date | null;

  @Column({ name: "archived_at", type: "timestamptz", nullable: true })
  archivedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => Branch, (branch) => branch.coffeeShop)
  branches!: Branch[];

  @OneToMany(() => Domain, (domain) => domain.coffeeShop)
  domains!: Domain[];
}
