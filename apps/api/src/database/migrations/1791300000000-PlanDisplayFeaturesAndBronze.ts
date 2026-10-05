import { MigrationInterface, QueryRunner } from "typeorm";
import { defaultPlanFeatures } from "../../subscriptions/plan-defaults";

export class PlanDisplayFeaturesAndBronze1791300000000 implements MigrationInterface {
  name = "PlanDisplayFeaturesAndBronze1791300000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE plan_display_feature_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(60) NOT NULL UNIQUE,
        label varchar(100) NOT NULL,
        sort_order smallint NOT NULL DEFAULT 10,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT CK_plan_display_feature_definition_label CHECK (btrim(label) <> ''),
        CONSTRAINT CK_plan_display_feature_definition_order CHECK (sort_order >= 0)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_plan_display_feature_definition_label ON plan_display_feature_definitions (lower(btrim(label)))`);
    await queryRunner.query(`
      CREATE TABLE plan_display_feature_values (
        plan_id uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE CASCADE,
        feature_definition_id uuid NOT NULL REFERENCES plan_display_feature_definitions(id) ON DELETE CASCADE,
        value varchar(160) NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (plan_id, feature_definition_id),
        CONSTRAINT CK_plan_display_feature_value_nonempty CHECK (btrim(value) <> '')
      )
    `);

    // Align plan defaults once, without changing plan IDs, subscriptions, or unknown feature values.
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features = COALESCE(features, '{}'::jsonb) || $1::jsonb,
          updated_at = now()
      WHERE key = $2
    `, [JSON.stringify(defaultPlanFeatures.silver), "silver"]);
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features = COALESCE(features, '{}'::jsonb) || $1::jsonb,
          updated_at = now()
      WHERE key = $2
    `, [JSON.stringify(defaultPlanFeatures.golden), "golden"]);
    await queryRunner.query(`
      INSERT INTO subscription_plans (key, name, description, status, price_toman, sort_order, billing_months, trial_days, grace_days, features, highlighted_feature_keys)
      VALUES ('bronze', 'برنزی', 'امکانات پایه برای مدیریت کافه', 'ACTIVE', 537000, 5, 1, 30, 7, $1::jsonb,
        ARRAY['menu','reservations']::text[])
      ON CONFLICT (key) DO NOTHING
    `, [JSON.stringify(defaultPlanFeatures.bronze)]);
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features = COALESCE(features, '{}'::jsonb) || $1::jsonb,
          updated_at = now()
      WHERE key = $2
    `, [JSON.stringify(defaultPlanFeatures.bronze), "bronze"]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Keep the plan row: the migration cannot distinguish a pre-existing Bronze plan from one it inserted.
    await queryRunner.query(`DROP TABLE plan_display_feature_values`);
    await queryRunner.query(`DROP INDEX UQ_plan_display_feature_definition_label`);
    await queryRunner.query(`DROP TABLE plan_display_feature_definitions`);
  }
}
