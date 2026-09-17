import { MigrationInterface, QueryRunner } from "typeorm";

export class ExpandSmsNotifications1787806800000 implements MigrationInterface {
  name = "ExpandSmsNotifications1787806800000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE "notification_deliveries" ALTER COLUMN "reservation_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" ADD COLUMN "related_entity_type" varchar(40), ADD COLUMN "related_entity_id" uuid, ADD COLUMN "deduplication_key" varchar(180)`);
    await queryRunner.query(`UPDATE "notification_deliveries" SET "related_entity_type"='reservation', "related_entity_id"="reservation_id", "deduplication_key"="type" || ':' || "reservation_id"::text`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" ALTER COLUMN "related_entity_type" SET NOT NULL, ALTER COLUMN "related_entity_id" SET NOT NULL, ALTER COLUMN "deduplication_key" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" DROP CONSTRAINT "uq_notification_delivery", ADD CONSTRAINT "UQ_notification_deliveries_deduplication" UNIQUE ("deduplication_key")`);
    await queryRunner.query(`ALTER TABLE "online_ordering_settings" ADD COLUMN "notify_admin_new_order" boolean NOT NULL DEFAULT false`);
    await queryRunner.query(`ALTER TABLE "reservation_settings" ADD COLUMN "notify_admin_new_reservation" boolean NOT NULL DEFAULT false, ADD COLUMN "reminder_hours" smallint NOT NULL DEFAULT 3, ADD CONSTRAINT "CK_reservation_reminder_hours" CHECK ("reminder_hours" BETWEEN 1 AND 72)`);
    await queryRunner.query(`ALTER TYPE "order_status" ADD VALUE IF NOT EXISTS 'CANCELED'`);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`DELETE FROM "notification_deliveries" WHERE "reservation_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" DROP CONSTRAINT "UQ_notification_deliveries_deduplication", ADD CONSTRAINT "uq_notification_delivery" UNIQUE ("reservation_id","type")`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" DROP COLUMN "deduplication_key", DROP COLUMN "related_entity_id", DROP COLUMN "related_entity_type", ALTER COLUMN "reservation_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reservation_settings" DROP CONSTRAINT "CK_reservation_reminder_hours", DROP COLUMN "reminder_hours", DROP COLUMN "notify_admin_new_reservation"`);
    await queryRunner.query(`ALTER TABLE "online_ordering_settings" DROP COLUMN "notify_admin_new_order"`);
    await queryRunner.query(`ALTER TYPE "order_status" RENAME TO "order_status_old"`);
    await queryRunner.query(`CREATE TYPE "order_status" AS ENUM ('UNDER_REVIEW','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED')`);
    await queryRunner.query(`ALTER TABLE "orders" ALTER COLUMN "status" DROP DEFAULT, ALTER COLUMN "status" TYPE "order_status" USING "status"::text::"order_status", ALTER COLUMN "status" SET DEFAULT 'UNDER_REVIEW'`);
    await queryRunner.query(`DROP TYPE "order_status_old"`);
  }
}
