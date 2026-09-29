import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from "typeorm";

@Entity({ name: "support_ticket_attachments" })
@Unique("UQ_support_ticket_attachments_storage_key", ["storageKey"])
@Index("IDX_support_ticket_attachments_message", ["coffeeShopId", "ticketMessageId"])
export class SupportTicketAttachment {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "ticket_message_id", type: "uuid" }) ticketMessageId!: string;
  @Column({ name: "storage_key", type: "text" }) storageKey!: string;
  @Column({ name: "original_filename", type: "varchar", length: 180 }) originalFilename!: string;
  @Column({ name: "detected_mime_type", type: "varchar", length: 64 }) detectedMimeType!: string;
  @Column({ name: "size_bytes", type: "integer" }) sizeBytes!: number;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
