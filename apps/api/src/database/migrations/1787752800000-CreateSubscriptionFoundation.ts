import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateSubscriptionFoundation1787752800000 implements MigrationInterface {
  name = "CreateSubscriptionFoundation1787752800000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "subscription_plan_status" AS ENUM ('ACTIVE','POSTPONED','ARCHIVED')`);
    await queryRunner.query(`CREATE TYPE "subscription_status" AS ENUM ('TRIALING','ACTIVE','GRACE','SUSPENDED','CANCELED')`);
    await queryRunner.query(`CREATE TYPE "subscription_payment_status" AS ENUM ('PAID','REFUNDED')`);

    await queryRunner.query(`
      CREATE TABLE "subscription_plans" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "key" varchar(40) NOT NULL UNIQUE,
        "name" varchar(100) NOT NULL,
        "status" subscription_plan_status NOT NULL,
        "price_toman" bigint NOT NULL,
        "billing_months" smallint NOT NULL DEFAULT 1,
        "trial_days" smallint NOT NULL DEFAULT 7,
        "grace_days" smallint NOT NULL DEFAULT 7,
        "features" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_subscription_plans_price" CHECK (price_toman >= 0),
        CONSTRAINT "CK_subscription_plans_periods" CHECK (billing_months > 0 AND trial_days >= 0 AND grace_days >= 0)
      )
    `);
    await queryRunner.query(`
      CREATE TABLE "subscriptions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL UNIQUE REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        "plan_id" uuid NOT NULL REFERENCES "subscription_plans"("id") ON DELETE RESTRICT,
        "status" subscription_status NOT NULL,
        "trial_started_at" timestamptz,
        "trial_ends_at" timestamptz,
        "current_period_started_at" timestamptz,
        "current_period_ends_at" timestamptz,
        "grace_ends_at" timestamptz,
        "suspended_at" timestamptz,
        "canceled_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_subscriptions_trial_range" CHECK (trial_ends_at IS NULL OR trial_started_at IS NOT NULL AND trial_ends_at > trial_started_at),
        CONSTRAINT "CK_subscriptions_period_range" CHECK (current_period_ends_at IS NULL OR current_period_started_at IS NOT NULL AND current_period_ends_at > current_period_started_at)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_subscriptions_status_due" ON "subscriptions" ("status", "current_period_ends_at", "trial_ends_at", "grace_ends_at")`);
    await queryRunner.query(`
      CREATE TABLE "subscription_payments" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "subscription_id" uuid NOT NULL REFERENCES "subscriptions"("id") ON DELETE RESTRICT,
        "status" subscription_payment_status NOT NULL DEFAULT 'PAID',
        "amount_toman" bigint NOT NULL,
        "plan_key_snapshot" varchar(40) NOT NULL,
        "plan_name_snapshot" varchar(100) NOT NULL,
        "period_started_at" timestamptz NOT NULL,
        "period_ends_at" timestamptz NOT NULL,
        "provider" varchar(40),
        "provider_reference" varchar(160),
        "recorded_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "paid_at" timestamptz NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_subscription_payments_amount" CHECK (amount_toman > 0),
        CONSTRAINT "CK_subscription_payments_period" CHECK (period_ends_at > period_started_at)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_subscription_payments_provider_reference" ON "subscription_payments" ("provider", "provider_reference") WHERE provider_reference IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_subscription_payments_subscription_paid" ON "subscription_payments" ("subscription_id", "paid_at" DESC)`);

    await queryRunner.query(`
      INSERT INTO "subscription_plans" ("key", "name", "status", "price_toman", "billing_months", "trial_days", "grace_days", "features") VALUES
      ('silver', 'نقره‌ای', 'ACTIVE', 1900000, 1, 7, 7, '{"menu":true,"reservations":true}'::jsonb),
      ('golden', 'طلایی', 'POSTPONED', 2900000, 1, 7, 7, '{"menu":true,"reservations":true}'::jsonb)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "subscription_payments"`);
    await queryRunner.query(`DROP TABLE "subscriptions"`);
    await queryRunner.query(`DROP TABLE "subscription_plans"`);
    await queryRunner.query(`DROP TYPE "subscription_payment_status"`);
    await queryRunner.query(`DROP TYPE "subscription_status"`);
    await queryRunner.query(`DROP TYPE "subscription_plan_status"`);
  }
}
