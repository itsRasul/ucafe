import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";
import { PromotionWeekday } from "../promotion-schedule.util";
import { Promotion } from "./promotion.entity";

@Entity({ name: "promotion_schedule_windows" })
@Index("IDX_promotion_schedule_windows_tenant_promotion", ["coffeeShopId", "promotionId"])
@Check("CK_promotion_schedule_windows_days", `cardinality(days_of_week) BETWEEN 1 AND 7 AND array_position(days_of_week, NULL) IS NULL AND days_of_week <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::varchar[]`)
@Check("CK_promotion_schedule_windows_time", "(is_all_day AND start_time IS NULL AND end_time IS NULL) OR (NOT is_all_day AND start_time IS NOT NULL AND end_time IS NOT NULL AND start_time <> end_time)")
export class PromotionScheduleWindow {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "promotion_id", type: "uuid" }) promotionId!: string;
  @Column({ name: "days_of_week", type: "varchar", array: true }) daysOfWeek!: PromotionWeekday[];
  @Column({ name: "start_time", type: "time", nullable: true }) startTime!: string | null;
  @Column({ name: "end_time", type: "time", nullable: true }) endTime!: string | null;
  @Column({ name: "is_all_day", type: "boolean", default: false }) isAllDay!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
  @ManyToOne(() => Promotion, (promotion) => promotion.scheduleWindows, { onDelete: "CASCADE" })
  @JoinColumn([{ name: "coffee_shop_id", referencedColumnName: "coffeeShopId" }, { name: "promotion_id", referencedColumnName: "id" }])
  promotion!: Promotion;
}
