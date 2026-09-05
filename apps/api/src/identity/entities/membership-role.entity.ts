import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { CoffeeShopMembership } from "./coffee-shop-membership.entity";
import { Role } from "./role.entity";

@Entity({ name: "membership_roles" })
export class MembershipRole {
  @PrimaryColumn({ name: "membership_id", type: "uuid" })
  membershipId!: string;

  @PrimaryColumn({ name: "role_id", type: "uuid" })
  roleId!: string;

  @ManyToOne(() => CoffeeShopMembership, { onDelete: "CASCADE" })
  @JoinColumn({ name: "membership_id" })
  membership!: CoffeeShopMembership;

  @ManyToOne(() => Role, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "role_id" })
  role!: Role;
}
