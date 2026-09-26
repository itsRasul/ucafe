import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_notes" })
@Index("idx_crm_notes_active_org_created", ["organizationId", "createdAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_notes_active_contact_created", ["contactId", "createdAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_notes_active_lead_created", ["leadId", "createdAt"], { where: '"archived_at" IS NULL' })
@Index("idx_crm_notes_active_deal_created", ["dealId", "createdAt"], { where: '"archived_at" IS NULL' })
export class CrmNote {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "organization_id", type: "uuid", nullable: true }) organizationId!: string | null;
  @Column({ name: "contact_id", type: "uuid", nullable: true }) contactId!: string | null;
  @Column({ name: "lead_id", type: "uuid", nullable: true }) leadId!: string | null;
  @Column({ name: "deal_id", type: "uuid", nullable: true }) dealId!: string | null;
  @Column({ type: "text" }) body!: string;
  @Column({ name: "author_user_id", type: "uuid", nullable: true }) authorUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @Column({ name: "archived_by_user_id", type: "uuid", nullable: true }) archivedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
