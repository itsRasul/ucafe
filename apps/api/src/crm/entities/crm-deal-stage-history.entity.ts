import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { CrmDealStage } from "./crm-deal.entity";

@Entity({ name: "crm_deal_stage_history" })
@Index("idx_crm_deal_stage_history_deal_created", ["dealId", "createdAt"])
export class CrmDealStageHistory {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "deal_id", type: "uuid" }) dealId!: string;
  @Column({ name: "pipeline_key", type: "varchar", length: 40 }) pipelineKey!: string;
  @Column({ name: "from_stage", type: "varchar", length: 32, nullable: true }) fromStage!: CrmDealStage | null;
  @Column({ name: "to_stage", type: "varchar", length: 32 }) toStage!: CrmDealStage;
  @Column({ type: "varchar", length: 500, nullable: true }) reason!: string | null;
  @Column({ name: "changed_by_user_id", type: "uuid", nullable: true }) changedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
