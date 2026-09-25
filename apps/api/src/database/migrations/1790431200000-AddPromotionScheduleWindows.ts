import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPromotionScheduleWindows1790431200000 implements MigrationInterface {
  name = "AddPromotionScheduleWindows1790431200000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "promotion_schedule_windows" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "coffee_shop_id" uuid NOT NULL,
      "promotion_id" uuid NOT NULL,
      "days_of_week" varchar[] NOT NULL,
      "start_time" time,
      "end_time" time,
      "is_all_day" boolean NOT NULL DEFAULT false,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_promotion_schedule_windows_promotion" FOREIGN KEY ("coffee_shop_id", "promotion_id") REFERENCES "promotions" ("coffee_shop_id", "id") ON DELETE CASCADE,
      CONSTRAINT "CK_promotion_schedule_windows_days" CHECK (cardinality("days_of_week") BETWEEN 1 AND 7 AND array_position("days_of_week", NULL) IS NULL AND "days_of_week" <@ ARRAY['MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY']::varchar[]),
      CONSTRAINT "CK_promotion_schedule_windows_time" CHECK (("is_all_day" AND "start_time" IS NULL AND "end_time" IS NULL) OR (NOT "is_all_day" AND "start_time" IS NOT NULL AND "end_time" IS NOT NULL AND "start_time" <> "end_time"))
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_promotion_schedule_windows_tenant_promotion" ON "promotion_schedule_windows" ("coffee_shop_id", "promotion_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_promotion_schedule_windows_tenant_promotion"`);
    await queryRunner.query(`DROP TABLE "promotion_schedule_windows"`);
  }
}
