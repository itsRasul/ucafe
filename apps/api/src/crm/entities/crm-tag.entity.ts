import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_tags" })
@Index("UQ_crm_tags_normalized_name", ["normalizedName"], { unique: true })
export class CrmTag {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 80 }) name!: string;
  @Column({ name: "normalized_name", type: "varchar", length: 80 }) normalizedName!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ type: "varchar", length: 24, nullable: true }) color!: string | null;
  @Column({ type: "boolean", default: true }) active!: boolean;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity({ name: "crm_entity_tags" })
@Index("UQ_crm_entity_tag_organization", ["tagId", "organizationId"], { unique: true, where: '"organization_id" IS NOT NULL' })
@Index("UQ_crm_entity_tag_contact", ["tagId", "contactId"], { unique: true, where: '"contact_id" IS NOT NULL' })
@Index("UQ_crm_entity_tag_lead", ["tagId", "leadId"], { unique: true, where: '"lead_id" IS NOT NULL' })
@Index("UQ_crm_entity_tag_deal", ["tagId", "dealId"], { unique: true, where: '"deal_id" IS NOT NULL' })
@Index("IDX_crm_entity_tag_organization", ["organizationId", "tagId"], { where: '"organization_id" IS NOT NULL' })
@Index("IDX_crm_entity_tag_contact", ["contactId", "tagId"], { where: '"contact_id" IS NOT NULL' })
@Index("IDX_crm_entity_tag_lead", ["leadId", "tagId"], { where: '"lead_id" IS NOT NULL' })
@Index("IDX_crm_entity_tag_deal", ["dealId", "tagId"], { where: '"deal_id" IS NOT NULL' })
export class CrmEntityTag {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "tag_id", type: "uuid" }) tagId!: string;
  @Column({ name: "organization_id", type: "uuid", nullable: true }) organizationId!: string | null;
  @Column({ name: "contact_id", type: "uuid", nullable: true }) contactId!: string | null;
  @Column({ name: "lead_id", type: "uuid", nullable: true }) leadId!: string | null;
  @Column({ name: "deal_id", type: "uuid", nullable: true }) dealId!: string | null;
  @Column({ name: "assigned_by_user_id", type: "uuid", nullable: true }) assignedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
