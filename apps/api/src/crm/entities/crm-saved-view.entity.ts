import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_saved_views" })
@Index("IDX_crm_saved_views_entity_owner", ["entityType", "ownerId", "archivedAt"])
export class CrmSavedView {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 120 }) name!: string;
  @Column({ name: "entity_type", type: "varchar", length: 24 }) entityType!: string;
  @Column({ type: "varchar", length: 16 }) visibility!: "PRIVATE" | "SHARED";
  @Column({ name: "owner_id", type: "uuid" }) ownerId!: string;
  @Column({ name: "filter_definition", type: "jsonb" }) filterDefinition!: Record<string, unknown>;
  @Column({ name: "query_definition", type: "jsonb", default: () => "'{}'::jsonb" }) queryDefinition!: Record<string, unknown>;
  @Column({ name: "sort_definition", type: "jsonb", nullable: true }) sortDefinition!: Record<string, unknown> | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
