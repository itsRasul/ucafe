import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";

@Entity({ name: "customer_segment_memberships" })
@Index("UQ_customer_segment_memberships", ["coffeeShopId", "segmentId", "clientId"], { unique: true })
@Index("IDX_customer_segment_memberships_client", ["coffeeShopId", "clientId"])
@Index("IDX_customer_segment_memberships_segment", ["coffeeShopId", "segmentId"])
export class CustomerSegmentMembership {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "segment_id", type: "uuid" }) segmentId!: string;
  @Column({ name: "client_id", type: "uuid" }) clientId!: string;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
