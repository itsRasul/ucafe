import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { NotificationPayload, NotificationType } from "../notification-type";
export enum NotificationStatus { Pending="PENDING", Processing="PROCESSING", Sent="SENT", Failed="FAILED" }
@Entity({ name: "notification_deliveries" })
export class NotificationDelivery {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name:"coffee_shop_id", type:"uuid" }) coffeeShopId!: string;
  @Column({ name:"reservation_id", type:"uuid", nullable:true }) reservationId!: string|null;
  @Column({ type:"varchar", length:50 }) type!: NotificationType;
  @Column({ name:"related_entity_type", type:"varchar", length:40 }) relatedEntityType!: string;
  @Column({ name:"related_entity_id", type:"uuid" }) relatedEntityId!: string;
  @Column({ name:"deduplication_key", type:"varchar", length:180, unique:true }) deduplicationKey!: string;
  @Column({ name:"recipient_ciphertext", type:"text", select:false }) recipientCiphertext!: string;
  @Column({ type:"jsonb" }) payload!: NotificationPayload;
  @Column({ type:"enum", enum:NotificationStatus, enumName:"notification_delivery_status", default:NotificationStatus.Pending }) status!: NotificationStatus;
  @Column({ type:"smallint", default:0 }) attempts!: number;
  @Column({ name:"next_attempt_at", type:"timestamptz", default:()=>"now()" }) nextAttemptAt!: Date;
  @Column({ name:"provider_message_id", type:"varchar", length:100, nullable:true }) providerMessageId!: string|null;
  @Column({ name:"last_error_code", type:"varchar", length:50, nullable:true }) lastErrorCode!: string|null;
  @Column({ name:"sent_at", type:"timestamptz", nullable:true }) sentAt!: Date|null;
  @CreateDateColumn({ name:"created_at", type:"timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name:"updated_at", type:"timestamptz" }) updatedAt!: Date;
}
