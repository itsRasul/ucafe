import { Check, Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn, Unique } from "typeorm";
import { Branch } from "../../database/entities";

@Entity({ name: "branch_opening_hours" })
@Unique("UQ_branch_opening_hours_day", ["branchId", "dayOfWeek"])
@Check("CK_branch_opening_hours_day", "day_of_week BETWEEN 0 AND 6")
@Check("CK_branch_opening_hours_values", "(is_closed AND opens_at IS NULL AND closes_at IS NULL) OR (NOT is_closed AND opens_at IS NOT NULL AND closes_at IS NOT NULL AND closes_at > opens_at)")
export class BranchOpeningHour {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "branch_id", type: "uuid" })
  branchId!: string;

  @Column({ name: "day_of_week", type: "smallint" })
  dayOfWeek!: number;

  @Column({ name: "is_closed", type: "boolean", default: false })
  isClosed!: boolean;

  @Column({ name: "opens_at", type: "time", nullable: true })
  opensAt!: string | null;

  @Column({ name: "closes_at", type: "time", nullable: true })
  closesAt!: string | null;

  @ManyToOne(() => Branch, { onDelete: "CASCADE" })
  @JoinColumn({ name: "branch_id" })
  branch!: Branch;
}
