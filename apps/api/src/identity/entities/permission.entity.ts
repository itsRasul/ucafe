import { Column, Entity, PrimaryGeneratedColumn, Unique } from "typeorm";
import { AuthorizationScope } from "./role.entity";

@Entity({ name: "permissions" })
@Unique("UQ_permissions_key", ["key"])
export class Permission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "enum", enum: AuthorizationScope, enumName: "authorization_scope" })
  scope!: AuthorizationScope;

  @Column({ type: "varchar", length: 120 })
  key!: string;

  @Column({ type: "varchar", length: 240 })
  description!: string;
}
