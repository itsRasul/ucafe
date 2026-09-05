import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";

export enum AuthorizationScope {
  Platform = "PLATFORM",
  Tenant = "TENANT",
}

@Entity({ name: "roles" })
@Index("UQ_roles_global_key", ["key"], { unique: true, where: "coffee_shop_id IS NULL" })
@Index("UQ_roles_tenant_key", ["coffeeShopId", "key"], { unique: true, where: "coffee_shop_id IS NOT NULL" })
@Check("CK_roles_platform_global", "scope <> 'PLATFORM' OR coffee_shop_id IS NULL")
export class Role {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid", nullable: true })
  coffeeShopId!: string | null;

  @Column({ type: "enum", enum: AuthorizationScope, enumName: "authorization_scope" })
  scope!: AuthorizationScope;

  @Column({ type: "varchar", length: 80 })
  key!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  @Column({ name: "is_protected", type: "boolean", default: false })
  isProtected!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop | null;
}
