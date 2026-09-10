import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, OneToMany, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { ClientAddress } from "./client-address.entity";

export enum ClientStatus {
  Active = "ACTIVE",
  Blocked = "BLOCKED",
}

@Entity({ name: "clients" })
@Unique("UQ_clients_tenant_phone", ["coffeeShopId", "phone"])
@Index("IDX_clients_tenant_created", ["coffeeShopId", "createdAt"])
@Check("CK_clients_phone_e164", "phone ~ '^\\+[1-9][0-9]{7,14}$'")
export class Client {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "first_name", type: "varchar", length: 80 })
  firstName!: string;

  @Column({ name: "last_name", type: "varchar", length: 80 })
  lastName!: string;

  @Column({ type: "varchar", length: 16 })
  phone!: string;

  @Column({ type: "enum", enum: ClientStatus, enumName: "client_status", default: ClientStatus.Active })
  status!: ClientStatus;

  @Column({ name: "phone_verified_at", type: "timestamptz", nullable: true })
  phoneVerifiedAt!: Date | null;

  @Column({ name: "last_authenticated_at", type: "timestamptz", nullable: true })
  lastAuthenticatedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @ManyToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @OneToMany(() => ClientAddress, (address) => address.client)
  addresses!: ClientAddress[];
}
