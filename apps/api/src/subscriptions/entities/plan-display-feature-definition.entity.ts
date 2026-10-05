import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "plan_display_feature_definitions" })
export class PlanDisplayFeatureDefinition {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ type: "varchar", length: 60, unique: true }) key!: string;
  @Column({ type: "varchar", length: 100 }) label!: string;
  @Column({ name: "sort_order", type: "smallint", default: 10 }) sortOrder!: number;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}
