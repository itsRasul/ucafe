import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum CrmDealStage {
  Discovery = "DISCOVERY",
  DemoScheduled = "DEMO_SCHEDULED",
  DemoCompleted = "DEMO_COMPLETED",
  TrialProposed = "TRIAL_PROPOSED",
  TrialActive = "TRIAL_ACTIVE",
  Decision = "DECISION",
}

export enum CrmDealStatus {
  Open = "OPEN",
  Won = "WON",
  Lost = "LOST",
}

export enum CrmDealLossReason {
  Price = "PRICE",
  Timing = "TIMING",
  ProductFit = "PRODUCT_FIT",
  NoResponse = "NO_RESPONSE",
  Competitor = "COMPETITOR",
  Other = "OTHER",
}

export const CRM_DEFAULT_PIPELINE_KEY = "ucafe-default";

@Entity({ name: "crm_deals" })
@Index("idx_crm_deals_active_stage_updated", ["pipelineKey", "status", "stage", "updatedAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_deals_active_owner_status", ["ownerId", "status", "updatedAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_deals_organization_created", ["organizationId", "createdAt"])
@Index("idx_crm_deals_active_plan", ["expectedPlanId"], { where: '"archived_at" IS NULL AND "expected_plan_id" IS NOT NULL' })
@Index("idx_crm_deals_active_close_date", ["expectedCloseDate"], { where: '"archived_at" IS NULL AND "expected_close_date" IS NOT NULL' })
@Index("uq_crm_deals_originating_lead", ["originatingLeadId"], { unique: true, where: '"originating_lead_id" IS NOT NULL' })
export class CrmDeal {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "organization_id", type: "uuid" }) organizationId!: string;
  @Column({ name: "primary_contact_id", type: "uuid", nullable: true }) primaryContactId!: string | null;
  @Column({ name: "originating_lead_id", type: "uuid", nullable: true }) originatingLeadId!: string | null;
  @Column({ name: "owner_id", type: "uuid", nullable: true }) ownerId!: string | null;
  @Column({ name: "expected_plan_id", type: "uuid", nullable: true }) expectedPlanId!: string | null;
  @Column({ name: "pipeline_key", type: "varchar", length: 40, default: CRM_DEFAULT_PIPELINE_KEY }) pipelineKey!: string;
  @Column({ type: "varchar", length: 200 }) title!: string;
  @Column({ name: "estimated_amount_toman", type: "bigint", nullable: true }) estimatedAmountToman!: string | null;
  @Column({ name: "expected_close_date", type: "date", nullable: true }) expectedCloseDate!: string | null;
  @Column({ type: "varchar", length: 32, default: CrmDealStage.Discovery }) stage!: CrmDealStage;
  @Column({ type: "varchar", length: 16, default: CrmDealStatus.Open }) status!: CrmDealStatus;
  @Column({ name: "loss_reason", type: "varchar", length: 24, nullable: true }) lossReason!: CrmDealLossReason | null;
  @Column({ name: "loss_reason_detail", type: "varchar", length: 500, nullable: true }) lossReasonDetail!: string | null;
  @Column({ name: "closed_at", type: "timestamptz", nullable: true }) closedAt!: Date | null;
  @Column({ name: "won_at", type: "timestamptz", nullable: true }) wonAt!: Date | null;
  @Column({ name: "lost_at", type: "timestamptz", nullable: true }) lostAt!: Date | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
