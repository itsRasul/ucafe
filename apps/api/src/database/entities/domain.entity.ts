import { Check, Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "./coffee-shop.entity";

export enum DomainType {
  PlatformSubdomain = "PLATFORM_SUBDOMAIN",
  Preview = "PREVIEW",
  Custom = "CUSTOM",
}

export enum DomainStatus {
  Pending = "PENDING",
  Active = "ACTIVE",
  Failed = "FAILED",
  Revoked = "REVOKED",
}

@Entity({ name: "domains" })
@Unique("UQ_domains_hostname", ["hostname"])
@Check("CK_domains_hostname_lowercase", "hostname = lower(hostname)")
@Index("UQ_domains_primary_per_tenant", ["coffeeShopId"], { unique: true, where: "is_primary = true AND deleted_at IS NULL" })
@Index("IDX_domains_tenant_status", ["coffeeShopId", "status"])
export class Domain {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ type: "varchar", length: 253 })
  hostname!: string;

  @Column({ type: "enum", enum: DomainType, enumName: "domain_type" })
  type!: DomainType;

  @Column({ type: "enum", enum: DomainStatus, enumName: "domain_status", default: DomainStatus.Pending })
  status!: DomainStatus;

  @Column({ name: "is_primary", type: "boolean", default: false })
  isPrimary!: boolean;

  @Column({ name: "verification_token_hash", type: "varchar", length: 128, nullable: true })
  verificationTokenHash!: string | null;

  @Column({ name: "verified_at", type: "timestamptz", nullable: true })
  verifiedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => CoffeeShop, (coffeeShop) => coffeeShop.domains, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;
}
