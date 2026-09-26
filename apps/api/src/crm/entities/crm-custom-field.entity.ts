import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum CrmCustomFieldEntityType { Organization = "ORGANIZATION", Contact = "CONTACT", Lead = "LEAD", Deal = "DEAL" }
export enum CrmCustomFieldType { Text = "TEXT", LongText = "LONG_TEXT", Number = "NUMBER", Boolean = "BOOLEAN", Date = "DATE", SingleSelect = "SINGLE_SELECT", MultiSelect = "MULTI_SELECT", Url = "URL" }

@Entity({ name: "crm_custom_field_definitions" })
@Index("UQ_crm_custom_field_entity_key", ["entityType", "key"], { unique: true })
@Index("IDX_crm_custom_field_active_order", ["entityType", "active", "sortOrder"])
export class CrmCustomFieldDefinition {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "entity_type", type: "varchar", length: 24 }) entityType!: CrmCustomFieldEntityType;
  @Column({ type: "varchar", length: 64 }) key!: string;
  @Column({ type: "varchar", length: 120 }) label!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ name: "data_type", type: "varchar", length: 24 }) dataType!: CrmCustomFieldType;
  @Column({ type: "boolean", default: false }) required!: boolean;
  @Column({ type: "boolean", default: true }) active!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity({ name: "crm_custom_field_options" })
@Index("IDX_crm_custom_field_option_order", ["fieldDefinitionId", "active", "sortOrder"])
export class CrmCustomFieldOption {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "field_definition_id", type: "uuid" }) fieldDefinitionId!: string;
  @Column({ type: "varchar", length: 120 }) label!: string;
  @Column({ type: "boolean", default: true }) active!: boolean;
  @Column({ name: "sort_order", type: "integer", default: 0 }) sortOrder!: number;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
