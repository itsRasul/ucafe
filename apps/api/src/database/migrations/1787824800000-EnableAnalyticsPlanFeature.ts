import { MigrationInterface, QueryRunner } from "typeorm";

export class EnableAnalyticsPlanFeature1787824800000 implements MigrationInterface {
  name = "EnableAnalyticsPlanFeature1787824800000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`UPDATE subscription_plans SET features = COALESCE(features, '{}'::jsonb) || '{"analytics":true}'::jsonb WHERE key = 'golden' AND NOT (COALESCE(features, '{}'::jsonb) ? 'analytics')`);
  }

  async down(_queryRunner: QueryRunner) { /* Preserve subsequent platform-admin feature edits. */ }
}
