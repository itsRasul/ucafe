import { Column, Entity, JoinColumn, OneToOne, PrimaryColumn } from "typeorm";
import { Branch } from "../../database/entities";

@Entity({ name: "reservation_settings" })
export class ReservationSettings {
  @PrimaryColumn({ name: "branch_id", type: "uuid" }) branchId!: string;
  @Column({ name: "is_enabled", type: "boolean", default: true }) isEnabled!: boolean;
  @Column({ name: "slot_interval_minutes", type: "smallint", default: 30 }) slotIntervalMinutes!: number;
  @Column({ name: "duration_minutes", type: "smallint", default: 90 }) durationMinutes!: number;
  @Column({ name: "minimum_party_size", type: "smallint", default: 1 }) minimumPartySize!: number;
  @Column({ name: "maximum_party_size", type: "smallint", default: 8 }) maximumPartySize!: number;
  @Column({ name: "maximum_concurrent_guests", type: "smallint", default: 20 }) maximumConcurrentGuests!: number;
  @Column({ name: "minimum_lead_minutes", type: "integer", default: 60 }) minimumLeadMinutes!: number;
  @Column({ name: "maximum_advance_days", type: "smallint", default: 30 }) maximumAdvanceDays!: number;
  @OneToOne(() => Branch, { onDelete: "CASCADE" }) @JoinColumn({ name: "branch_id" }) branch!: Branch;
}
