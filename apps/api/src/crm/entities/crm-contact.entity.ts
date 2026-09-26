import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_contacts" })
@Index("IDX_crm_contacts_organization_name", ["organizationId", "name"])
@Index("IDX_crm_contacts_organization_phone_hash", ["organizationId", "phoneHash"])
@Index("IDX_crm_contacts_organization_email_hash", ["organizationId", "emailHash"])
export class CrmContact {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "organization_id", type: "uuid" }) organizationId!: string;
  @Column({ type: "varchar", length: 160 }) name!: string;
  @Column({ type: "varchar", length: 100, nullable: true }) role!: string | null;
  @Column({ name: "phone_encrypted", type: "text", nullable: true, select: false }) phoneEncrypted!: string | null;
  @Column({ name: "phone_hash", type: "char", length: 64, nullable: true }) phoneHash!: string | null;
  @Column({ name: "email_encrypted", type: "text", nullable: true, select: false }) emailEncrypted!: string | null;
  @Column({ name: "email_hash", type: "char", length: 64, nullable: true }) emailHash!: string | null;
  @Column({ name: "custom_fields", type: "jsonb", default: () => "'{}'::jsonb" }) customFields!: Record<string, unknown>;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "updated_by_user_id", type: "uuid", nullable: true }) updatedByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
