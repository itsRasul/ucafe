import { Column, CreateDateColumn, DeleteDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";
import { Client } from "./client.entity";

@Entity({ name: "client_addresses" })
@Index("IDX_client_addresses_client_active", ["coffeeShopId", "clientId"], { where: "deleted_at IS NULL" })
export class ClientAddress {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "client_id", type: "uuid" })
  clientId!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  label!: string | null;

  @Column({ name: "address_line", type: "varchar", length: 700 })
  addressLine!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  province!: string | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  city!: string | null;

  @Column({ name: "building_number", type: "varchar", length: 20, nullable: true })
  buildingNumber!: string | null;

  @Column({ type: "varchar", length: 20, nullable: true })
  unit!: string | null;

  @Column({ name: "postal_code", type: "varchar", length: 10, nullable: true })
  postalCode!: string | null;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @ManyToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;

  @ManyToOne(() => Client, (client) => client.addresses, { onDelete: "CASCADE" })
  @JoinColumn({ name: "client_id" })
  client!: Client;
}
