import { MigrationInterface, QueryRunner } from "typeorm";

export class ThirtyDayTrialPolicy1791200000000 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE subscription_plans ALTER COLUMN trial_days SET DEFAULT 30`);
    await queryRunner.query(`UPDATE subscription_plans SET trial_days=30, updated_at=now() WHERE trial_days<>30`);
    // Deliberately preserve all stored subscription trial boundaries and paid periods.
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE subscription_plans ALTER COLUMN trial_days SET DEFAULT 7`);
    // Previous administrator-configured values cannot safely be reconstructed.
  }
}
