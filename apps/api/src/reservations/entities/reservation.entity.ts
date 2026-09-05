import { Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { Branch, CoffeeShop } from "../../database/entities";
import { User } from "../../identity/entities";

export enum ReservationStatus { Pending = "PENDING", Confirmed = "CONFIRMED", Rejected = "REJECTED", Canceled = "CANCELED", Completed = "COMPLETED", NoShow = "NO_SHOW" }

@Entity({ name: "reservations" })
@Index("IDX_reservations_tenant_date_status", ["coffeeShopId", "reservationDate", "status"])
@Index("IDX_reservations_branch_slot", ["branchId", "reservationDate", "startTime", "endTime"])
export class Reservation {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "branch_id", type: "uuid" }) branchId!: string;
  @Column({ name: "customer_user_id", type: "uuid" }) customerUserId!: string;
  @Column({ name: "contact_name", type: "varchar", length: 100 }) contactName!: string;
  @Column({ name: "reservation_date", type: "date" }) reservationDate!: string;
  @Column({ name: "start_time", type: "time" }) startTime!: string;
  @Column({ name: "end_time", type: "time" }) endTime!: string;
  @Column({ name: "party_size", type: "smallint" }) partySize!: number;
  @Column({ type: "enum", enum: ReservationStatus, enumName: "reservation_status", default: ReservationStatus.Pending }) status!: ReservationStatus;
  @Column({ name: "customer_note", type: "varchar", length: 500, nullable: true }) customerNote!: string | null;
  @Column({ name: "staff_note", type: "varchar", length: 500, nullable: true }) staffNote!: string | null;
  @Column({ name: "status_changed_at", type: "timestamptz", nullable: true }) statusChangedAt!: Date | null;
  @Column({ name: "status_changed_by_user_id", type: "uuid", nullable: true }) statusChangedByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @ManyToOne(() => CoffeeShop, { onDelete: "RESTRICT" }) @JoinColumn({ name: "coffee_shop_id" }) coffeeShop!: CoffeeShop;
  @ManyToOne(() => Branch, { onDelete: "RESTRICT" }) @JoinColumn({ name: "branch_id" }) branch!: Branch;
  @ManyToOne(() => User, { onDelete: "RESTRICT" }) @JoinColumn({ name: "customer_user_id" }) customer!: User;
}
