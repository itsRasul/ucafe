import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "crm_segments" })
@Index("IDX_crm_segments_entity_active", ["entityType", "archivedAt"])
export class CrmSegment {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 120 }) name!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ name: "entity_type", type: "varchar", length: 24 }) entityType!: string;
  @Column({ name: "filter_definition", type: "jsonb" }) filterDefinition!: Record<string, unknown>;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "archived_at", type: "timestamptz", nullable: true }) archivedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
