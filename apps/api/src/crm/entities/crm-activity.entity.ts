import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum CrmActivityType { Call = "CALL", Meeting = "MEETING", Demo = "DEMO", Email = "EMAIL", Sms = "SMS", WhatsApp = "WHATSAPP", Other = "OTHER" }
export enum CrmCallOutcome { Connected = "CONNECTED", NoAnswer = "NO_ANSWER", Busy = "BUSY", CallBackRequested = "CALL_BACK_REQUESTED", NotInterested = "NOT_INTERESTED", Interested = "INTERESTED", InvalidNumber = "INVALID_NUMBER", Other = "OTHER" }
export enum CrmMeetingOutcome { Completed = "COMPLETED", Canceled = "CANCELED", NoShow = "NO_SHOW", Rescheduled = "RESCHEDULED", Other = "OTHER" }

@Entity({ name: "crm_activities" })
@Index("idx_crm_activities_active_org_occurred", ["organizationId", "occurredAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_activities_active_contact_occurred", ["contactId", "occurredAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_activities_active_lead_occurred", ["leadId", "occurredAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_activities_active_deal_occurred", ["dealId", "occurredAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_activities_active_actor_occurred", ["actorUserId", "occurredAt"], { where: '"archived_at" IS NULL' })
export class CrmActivity {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "organization_id", type: "uuid", nullable: true }) organizationId!: string | null;
  @Column({ name: "contact_id", type: "uuid", nullable: true }) contactId!: string | null;
  @Column({ name: "lead_id", type: "uuid", nullable: true }) leadId!: string | null;
  @Column({ name: "deal_id", type: "uuid", nullable: true }) dealId!: string | null;
  @Column({ name: "activity_type", type: "varchar", length: 16 }) activityType!: CrmActivityType;
  @Column({ type: "varchar", length: 200 }) subject!: string;
  @Column({ type: "text", nullable: true }) details!: string | null;
  @Column({ name: "occurred_at", type: "timestamptz" }) occurredAt!: Date;
  @Column({ type: "varchar", length: 32, nullable: true }) outcome!: CrmCallOutcome | CrmMeetingOutcome | null;
  @Column({ name: "actor_user_id", type: "uuid", nullable: true }) actorUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @Column({ name: "archived_by_user_id", type: "uuid", nullable: true }) archivedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
