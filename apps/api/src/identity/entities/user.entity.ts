import { Check, Column, CreateDateColumn, DeleteDateColumn, Entity, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShopMembership } from "./coffee-shop-membership.entity";

export enum UserStatus {
  Active = "ACTIVE",
  Blocked = "BLOCKED",
  Deleted = "DELETED",
}

@Entity({ name: "users" })
@Unique("UQ_users_phone", ["phone"])
@Unique("UQ_users_email", ["email"])
@Check("CK_users_identity", "phone IS NOT NULL OR email IS NOT NULL")
@Check("CK_users_phone_e164", "phone IS NULL OR phone ~ '^\\+[1-9][0-9]{7,14}$'")
@Check("CK_users_email_lowercase", "email IS NULL OR email = lower(email)")
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 16, nullable: true })
  phone!: string | null;

  @Column({ type: "varchar", length: 254, nullable: true })
  email!: string | null;

  @Column({ name: "password_hash", type: "varchar", length: 255, nullable: true, select: false })
  passwordHash!: string | null;

  @Column({ type: "enum", enum: UserStatus, enumName: "user_status", default: UserStatus.Active })
  status!: UserStatus;

  @Column({ type: "varchar", length: 16, default: "fa-IR" })
  locale!: string;

  @Column({ name: "phone_verified_at", type: "timestamptz", nullable: true })
  phoneVerifiedAt!: Date | null;

  @Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
  emailVerifiedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany(() => CoffeeShopMembership, (membership) => membership.user)
  memberships!: CoffeeShopMembership[];
}
