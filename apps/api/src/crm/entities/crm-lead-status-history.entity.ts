import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from "typeorm";
import { CrmLeadStatus } from "./crm-lead.entity";

@Entity({ name: "crm_lead_status_history" })
@Index("IDX_crm_lead_status_history_lead_created", ["leadId", "createdAt"])
export class CrmLeadStatusHistory {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "lead_id", type: "uuid" }) leadId!: string;
  @Column({ name: "previous_status", type: "varchar", length: 24, nullable: true }) previousStatus!: CrmLeadStatus | null;
  @Column({ name: "next_status", type: "varchar", length: 24 }) nextStatus!: CrmLeadStatus;
  @Column({ type: "varchar", length: 500, nullable: true }) reason!: string | null;
  @Column({ name: "changed_by_user_id", type: "uuid", nullable: true }) changedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
