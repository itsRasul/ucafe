import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum PlatformOrderBusinessStage {
  Launching = "LAUNCHING",
  Operating = "OPERATING",
  MultiBranch = "MULTI_BRANCH",
}

export enum PlatformOrderService {
  Website = "WEBSITE",
  OnlineMenu = "ONLINE_MENU",
  Reservations = "RESERVATIONS",
  ContentManagement = "CONTENT_MANAGEMENT",
  Consultation = "CONSULTATION",
}

export enum PlatformOrderStatus {
  New = "NEW",
  Contacted = "CONTACTED",
  Qualified = "QUALIFIED",
  Closed = "CLOSED",
}

@Entity({ name: "platform_order_requests" })
@Index("IDX_platform_order_requests_phone_hash_created_at", ["phoneHash", "createdAt"])
export class PlatformOrderRequest {
  @PrimaryGeneratedColumn("uuid") id!: string;

  @Column({ name: "contact_name", type: "varchar", length: 100 }) contactName!: string;
  @Column({ name: "coffee_shop_name", type: "varchar", length: 160 }) coffeeShopName!: string;
  @Column({ name: "phone_encrypted", type: "text" }) phoneEncrypted!: string;
  @Column({ name: "phone_hash", type: "char", length: 64 }) phoneHash!: string;
  @Column({ type: "varchar", length: 100 }) city!: string;
  @Column({ name: "business_stage", type: "enum", enum: PlatformOrderBusinessStage, enumName: "platform_order_business_stage" }) businessStage!: PlatformOrderBusinessStage;
  @Column({ name: "requested_services", type: "enum", enum: PlatformOrderService, enumName: "platform_order_service", array: true }) requestedServices!: PlatformOrderService[];
  @Column({ type: "varchar", length: 1000, nullable: true }) note!: string | null;
  @Column({ type: "enum", enum: PlatformOrderStatus, enumName: "platform_order_status", default: PlatformOrderStatus.New }) status!: PlatformOrderStatus;
  @Column({ type: "varchar", length: 40, default: "platform_landing" }) source!: string;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
