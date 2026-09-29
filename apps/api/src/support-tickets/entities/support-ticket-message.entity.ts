import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { SupportTicketSenderType } from "./support-ticket.entity";

@Entity({ name: "support_ticket_messages" })
@Index("IDX_support_ticket_messages_thread", ["coffeeShopId", "ticketId", "createdAt", "id"])
export class SupportTicketMessage {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "ticket_id", type: "uuid" }) ticketId!: string;
  @Column({ name: "sender_user_id", type: "uuid" }) senderUserId!: string;
  @Column({ name: "sender_type", type: "enum", enum: SupportTicketSenderType, enumName: "support_ticket_sender_type" }) senderType!: SupportTicketSenderType;
  @Column({ type: "text" }) body!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
