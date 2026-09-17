import { MigrationInterface, QueryRunner } from "typeorm";

export class AddCanceledPaymentStatus1787810400000 implements MigrationInterface {
  name = "AddCanceledPaymentStatus1787810400000";
  async up(queryRunner: QueryRunner) { await queryRunner.query(`ALTER TYPE "payment_intent_status" ADD VALUE IF NOT EXISTS 'CANCELED'`); }
  async down() { /* PostgreSQL enum values are intentionally not removed. */ }
}
