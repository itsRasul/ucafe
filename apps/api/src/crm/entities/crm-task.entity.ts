import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum CrmTaskStatus { Open = "OPEN", Completed = "COMPLETED", Canceled = "CANCELED" }
export enum CrmTaskPriority { Low = "LOW", Normal = "NORMAL", High = "HIGH", Urgent = "URGENT" }
export enum CrmTaskKind { General = "GENERAL", FollowUp = "FOLLOW_UP" }

@Entity({ name: "crm_tasks" })
@Index("idx_crm_tasks_active_assignee_status_due", ["assignedToUserId", "status", "dueAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_tasks_active_org_status_due", ["organizationId", "status", "dueAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_tasks_active_contact_due", ["contactId", "dueAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_tasks_active_lead_due", ["leadId", "dueAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_tasks_active_deal_due", ["dealId", "dueAt"], { where: '"archived_at" IS NULL' })
export class CrmTask {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "organization_id", type: "uuid", nullable: true }) organizationId!: string | null;
  @Column({ name: "contact_id", type: "uuid", nullable: true }) contactId!: string | null;
  @Column({ name: "lead_id", type: "uuid", nullable: true }) leadId!: string | null;
  @Column({ name: "deal_id", type: "uuid", nullable: true }) dealId!: string | null;
  @Column({ type: "varchar", length: 200 }) title!: string;
  @Column({ type: "text", nullable: true }) description!: string | null;
  @Column({ type: "varchar", length: 16, default: CrmTaskKind.General }) kind!: CrmTaskKind;
  @Column({ type: "varchar", length: 16, default: CrmTaskStatus.Open }) status!: CrmTaskStatus;
  @Column({ type: "varchar", length: 16, default: CrmTaskPriority.Normal }) priority!: CrmTaskPriority;
  @Column({ name: "due_at", type: "timestamptz", nullable: true }) dueAt!: Date | null;
  @Column({ name: "assigned_to_user_id", type: "uuid", nullable: true }) assignedToUserId!: string | null;
  @Column({ name: "completed_at", type: "timestamptz", nullable: true }) completedAt!: Date | null;
  @Column({ name: "completed_by_user_id", type: "uuid", nullable: true }) completedByUserId!: string | null;
  @Column({ name: "canceled_at", type: "timestamptz", nullable: true }) canceledAt!: Date | null;
  @Column({ name: "canceled_by_user_id", type: "uuid", nullable: true }) canceledByUserId!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @Column({ name: "archived_by_user_id", type: "uuid", nullable: true }) archivedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
