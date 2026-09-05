import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from "typeorm";
import { Role } from "./role.entity";
import { User } from "./user.entity";

@Entity({ name: "user_platform_roles" })
export class UserPlatformRole {
  @PrimaryColumn({ name: "user_id", type: "uuid" })
  userId!: string;

  @PrimaryColumn({ name: "role_id", type: "uuid" })
  roleId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @ManyToOne(() => Role, { onDelete: "RESTRICT" })
  @JoinColumn({ name: "role_id" })
  role!: Role;
}
