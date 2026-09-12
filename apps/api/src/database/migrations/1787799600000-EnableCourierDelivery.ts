import { MigrationInterface, QueryRunner } from "typeorm";

export class EnableCourierDelivery1787799600000 implements MigrationInterface {
  name = "EnableCourierDelivery1787799600000";
  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE "online_ordering_settings" ALTER COLUMN "courier_enabled" SET DEFAULT true`);
    await queryRunner.query(`UPDATE "online_ordering_settings" SET "courier_enabled" = true WHERE "courier_enabled" = false`);
  }
  async down(queryRunner: QueryRunner) { await queryRunner.query(`ALTER TABLE "online_ordering_settings" ALTER COLUMN "courier_enabled" SET DEFAULT false`); }
}
