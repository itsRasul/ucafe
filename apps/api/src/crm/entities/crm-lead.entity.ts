import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum CrmLeadStatus {
  New = "NEW",
  AttemptingContact = "ATTEMPTING_CONTACT",
  Contacted = "CONTACTED",
  Qualified = "QUALIFIED",
  Nurturing = "NURTURING",
  Unqualified = "UNQUALIFIED",
  Converted = "CONVERTED",
}

export enum CrmLeadSource {
  OutboundCall = "OUTBOUND_CALL",
  LandingForm = "LANDING_FORM",
  Seo = "SEO",
  Instagram = "INSTAGRAM",
  Referral = "REFERRAL",
  Sms = "SMS",
  Partner = "PARTNER",
  Manual = "MANUAL",
  Other = "OTHER",
}

export enum CrmLeadPriority {
  Low = "LOW",
  Normal = "NORMAL",
  High = "HIGH",
}

export enum CrmLeadUnqualifiedReason {
  NotInterested = "NOT_INTERESTED",
  NotRelevant = "NOT_RELEVANT",
  NoBudget = "NO_BUDGET",
  NoResponse = "NO_RESPONSE",
  Duplicate = "DUPLICATE",
  InvalidContact = "INVALID_CONTACT",
  Competitor = "ALREADY_USING_COMPETITOR",
  TooEarly = "TOO_EARLY",
  Other = "OTHER",
}

@Entity({ name: "crm_leads" })
@Index("IDX_crm_leads_active_status_created", ["status", "createdAt"], { where: '"archived_at" IS NULL' })
@Index("IDX_crm_leads_active_owner_status", ["ownerId", "status"], { where: '"archived_at" IS NULL' })
@Index("IDX_crm_leads_active_source_created", ["source", "createdAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_leads_organization", ["organizationId"], { where: '"organization_id" IS NOT NULL' })
@Index("idx_crm_leads_primary_contact", ["primaryContactId"], { where: '"primary_contact_id" IS NOT NULL' })
@Index("idx_crm_leads_business_city", ["businessNameNormalized", "cityNormalized"])
@Index("idx_crm_leads_city", ["cityNormalized"], { where: '"city_normalized" IS NOT NULL' })
@Index("idx_crm_leads_phone_hash", ["phoneHash"], { where: '"phone_hash" IS NOT NULL' })
@Index("idx_crm_leads_email_hash", ["emailHash"], { where: '"email_hash" IS NOT NULL' })
@Index("UQ_crm_leads_source_request_id", ["sourceRequestId"], { unique: true, where: '"source_request_id" IS NOT NULL' })
export class CrmLead {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "business_name", type: "varchar", length: 160 }) businessName!: string;
  @Column({ name: "business_name_normalized", type: "varchar", length: 160 }) businessNameNormalized!: string;
  @Column({ name: "contact_name", type: "varchar", length: 160, nullable: true }) contactName!: string | null;
  @Column({ name: "phone_encrypted", type: "text", nullable: true, select: false }) phoneEncrypted!: string | null;
  @Column({ name: "phone_hash", type: "char", length: 64, nullable: true }) phoneHash!: string | null;
  @Column({ name: "email_encrypted", type: "text", nullable: true, select: false }) emailEncrypted!: string | null;
  @Column({ name: "email_hash", type: "char", length: 64, nullable: true }) emailHash!: string | null;
  @Column({ type: "varchar", length: 100, nullable: true }) city!: string | null;
  @Column({ name: "city_normalized", type: "varchar", length: 100, nullable: true }) cityNormalized!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) website!: string | null;
  @Column({ name: "website_host", type: "varchar", length: 255, nullable: true }) websiteHost!: string | null;
  @Column({ name: "instagram_handle", type: "varchar", length: 30, nullable: true }) instagramHandle!: string | null;
  @Column({ type: "varchar", length: 1000, nullable: true }) description!: string | null;
  @Column({ type: "varchar", length: 24, default: CrmLeadSource.Manual }) source!: CrmLeadSource;
  @Column({ type: "varchar", length: 24, default: CrmLeadStatus.New }) status!: CrmLeadStatus;
  @Column({ type: "varchar", length: 12, default: CrmLeadPriority.Normal }) priority!: CrmLeadPriority;
  @Column({ name: "owner_id", type: "uuid", nullable: true }) ownerId!: string | null;
  @Column({ name: "organization_id", type: "uuid", nullable: true }) organizationId!: string | null;
  @Column({ name: "primary_contact_id", type: "uuid", nullable: true }) primaryContactId!: string | null;
  @Column({ name: "source_request_id", type: "uuid", nullable: true }) sourceRequestId!: string | null;
  @Column({ name: "qualification_notes", type: "varchar", length: 2000, nullable: true }) qualificationNotes!: string | null;
  @Column({ name: "unqualified_reason", type: "varchar", length: 32, nullable: true }) unqualifiedReason!: CrmLeadUnqualifiedReason | null;
  @Column({ name: "unqualified_reason_detail", type: "varchar", length: 500, nullable: true }) unqualifiedReasonDetail!: string | null;
  @Column({ name: "custom_fields", type: "jsonb", default: () => "'{}'::jsonb" }) customFields!: Record<string, unknown>;
  @Column({ name: "qualified_at", type: "timestamptz", nullable: true }) qualifiedAt!: Date | null;
  @Column({ name: "converted_at", type: "timestamptz", nullable: true }) convertedAt!: Date | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
