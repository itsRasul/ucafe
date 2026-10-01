import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, Unique } from "typeorm";

export enum SupportTicketDepartment { Technical = "TECHNICAL", Sales = "SALES" }
export enum SupportTicketStatus { WaitingForPlatform = "WAITING_FOR_PLATFORM", WaitingForTenant = "WAITING_FOR_TENANT", Closed = "CLOSED" }
export enum SupportTicketCloseReason { Manual = "MANUAL", Inactivity = "INACTIVITY" }
export enum SupportTicketSenderType { TenantUser = "TENANT_USER", PlatformUser = "PLATFORM_USER" }

@Entity({ name: "support_tickets" })
@Unique("UQ_support_tickets_tenant_id", ["coffeeShopId", "id"])
@Index("IDX_support_tickets_tenant_activity", ["coffeeShopId", "status", "lastMessageAt", "id"])
@Index("IDX_support_tickets_platform_activity", ["status", "department", "lastMessageAt", "id"])
@Index("IDX_support_tickets_inactivity", ["lastPlatformReplyAt"], { where: `status = 'WAITING_FOR_TENANT'` })
export class SupportTicket {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "reference_number", type: "varchar", length: 24, unique: true }) referenceNumber!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "created_by_user_id", type: "uuid" }) createdByUserId!: string;
  @Column({ type: "varchar", length: 160 }) subject!: string;
  @Column({ type: "enum", enum: SupportTicketDepartment, enumName: "support_ticket_department" }) department!: SupportTicketDepartment;
  @Column({ type: "enum", enum: SupportTicketStatus, enumName: "support_ticket_status" }) status!: SupportTicketStatus;
  @Column({ name: "close_reason", type: "enum", enum: SupportTicketCloseReason, enumName: "support_ticket_close_reason", nullable: true }) closeReason!: SupportTicketCloseReason | null;
  @Column({ name: "closed_at", type: "timestamptz", nullable: true }) closedAt!: Date | null;
  @Column({ name: "closed_by_user_id", type: "uuid", nullable: true }) closedByUserId!: string | null;
  @Column({ name: "last_message_at", type: "timestamptz" }) lastMessageAt!: Date;
  @Column({ name: "last_message_sender_type", type: "enum", enum: SupportTicketSenderType, enumName: "support_ticket_sender_type" }) lastMessageSenderType!: SupportTicketSenderType;
  @Column({ name: "last_platform_reply_at", type: "timestamptz", nullable: true }) lastPlatformReplyAt!: Date | null;
  @Column({ name: "tenant_last_read_at", type: "timestamptz", nullable: true }) tenantLastReadAt!: Date | null;
  @Column({ name: "platform_last_read_at", type: "timestamptz", nullable: true }) platformLastReadAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
