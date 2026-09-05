import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { User } from "./user.entity";

export enum MembershipStatus {
  Invited = "INVITED",
  Active = "ACTIVE",
  Suspended = "SUSPENDED",
  Revoked = "REVOKED",
}

@Entity({ name: "coffee_shop_memberships" })
@Unique("UQ_memberships_tenant_user", ["coffeeShopId", "userId"])
@Index("IDX_memberships_user_status", ["userId", "status"])
@Index("IDX_memberships_tenant_status", ["coffeeShopId", "status"])
export class CoffeeShopMembership {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @Column({ type: "enum", enum: MembershipStatus, enumName: "membership_status", default: MembershipStatus.Invited })
  status!: MembershipStatus;

  @Column({ name: "invited_by_user_id", type: "uuid", nullable: true })
  invitedByUserId!: string | null;

  @Column({ name: "invited_at", type: "timestamptz", nullable: true })
  invitedAt!: Date | null;

  @Column({ name: "accepted_at", type: "timestamptz", nullable: true })
  acceptedAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @ManyToOne(() => User, { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by_user_id" })
  invitedByUser!: User | null;
}
