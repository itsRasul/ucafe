import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
export enum NotificationStatus { Pending="PENDING", Processing="PROCESSING", Sent="SENT", Failed="FAILED" }
@Entity({ name: "notification_deliveries" })
export class NotificationDelivery {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name:"coffee_shop_id", type:"uuid" }) coffeeShopId!: string;
  @Column({ name:"reservation_id", type:"uuid" }) reservationId!: string;
  @Column({ type:"varchar", length:50 }) type!: string;
  @Column({ name:"recipient_ciphertext", type:"text", select:false }) recipientCiphertext!: string;
  @Column({ type:"jsonb" }) payload!: { cafeName:string; date:string; time:string };
  @Column({ type:"enum", enum:NotificationStatus, enumName:"notification_delivery_status", default:NotificationStatus.Pending }) status!: NotificationStatus;
  @Column({ type:"smallint", default:0 }) attempts!: number;
  @Column({ name:"next_attempt_at", type:"timestamptz", default:()=>"now()" }) nextAttemptAt!: Date;
  @Column({ name:"provider_message_id", type:"varchar", length:100, nullable:true }) providerMessageId!: string|null;
  @Column({ name:"last_error_code", type:"varchar", length:50, nullable:true }) lastErrorCode!: string|null;
  @Column({ name:"sent_at", type:"timestamptz", nullable:true }) sentAt!: Date|null;
  @CreateDateColumn({ name:"created_at", type:"timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name:"updated_at", type:"timestamptz" }) updatedAt!: Date;
}
