import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn, UpdateDateColumn } from "typeorm";
import { CoffeeShop } from "../../database/entities";

@Entity({ name: "online_ordering_settings" })
export class OnlineOrderingSettings {
  @PrimaryColumn({ name: "coffee_shop_id", type: "uuid" })
  coffeeShopId!: string;

  @Column({ name: "pickup_enabled", type: "boolean", default: true })
  pickupEnabled!: boolean;

  @Column({ name: "courier_enabled", type: "boolean", default: true })
  courierEnabled!: boolean;

  @Column({ name: "offline_payment_enabled", type: "boolean", default: true })
  offlinePaymentEnabled!: boolean;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;

  @OneToOne(() => CoffeeShop, { onDelete: "CASCADE" })
  @JoinColumn({ name: "coffee_shop_id" })
  coffeeShop!: CoffeeShop;
}
