import { MigrationInterface, QueryRunner } from "typeorm";

export class UpgradeSubscriptionBilling1787817600000 implements MigrationInterface {
  name = "UpgradeSubscriptionBilling1787817600000";

  async up(q: QueryRunner) {
    await q.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM subscription_payments WHERE status='PAID' AND (period_started_at IS NULL OR period_ends_at IS NULL OR period_ends_at <= period_started_at)) THEN RAISE EXCEPTION 'Invalid paid subscription period data'; END IF;
      IF EXISTS (SELECT 1 FROM subscriptions WHERE current_period_started_at IS NOT NULL AND current_period_ends_at IS NOT NULL AND current_period_ends_at <= current_period_started_at) THEN RAISE EXCEPTION 'Invalid subscription period range'; END IF;
      IF EXISTS (SELECT 1 FROM subscription_payments sp LEFT JOIN subscriptions s ON s.id=sp.subscription_id LEFT JOIN subscription_plans p ON p.key=sp.plan_key_snapshot WHERE sp.status='PAID' AND (s.id IS NULL OR p.id IS NULL)) THEN RAISE EXCEPTION 'Paid subscription data references a missing subscription or plan'; END IF;
      IF EXISTS (SELECT 1 FROM subscription_payments a JOIN subscription_payments b ON a.subscription_id=b.subscription_id AND a.id<b.id AND a.status='PAID' AND b.status='PAID' AND tstzrange(a.period_started_at,a.period_ends_at,'[)') && tstzrange(b.period_started_at,b.period_ends_at,'[)')) THEN RAISE EXCEPTION 'Overlapping paid subscription periods require manual review'; END IF;
    END $$`);
    await q.query(`CREATE TYPE "subscription_operation" AS ENUM ('LEGACY','PURCHASE','RENEWAL','REACTIVATION','TRIAL_TO_PAID','UPGRADE')`);
    await q.query(`ALTER TABLE "subscription_plans" ADD "description" varchar(500) NOT NULL DEFAULT '', ADD "sort_order" smallint, ADD "highlighted_feature_keys" text[] NOT NULL DEFAULT '{}'::text[]`);
    await q.query(`WITH ranked AS (SELECT id, row_number() OVER (ORDER BY price_toman, key) * 10 AS rank FROM subscription_plans) UPDATE subscription_plans p SET sort_order=ranked.rank FROM ranked WHERE p.id=ranked.id`);
    await q.query(`UPDATE subscription_plans SET description=CASE key WHEN 'silver' THEN 'امکانات اصلی برای مدیریت روزمره کافه' WHEN 'golden' THEN 'امکانات کامل برای رشد و مدیریت حرفه‌ای کافه' ELSE description END`);
    await q.query(`UPDATE subscription_plans SET highlighted_feature_keys=ARRAY(SELECT key FROM jsonb_each_text(features) WHERE value='true' ORDER BY key)`);
    await q.query(`ALTER TABLE "subscription_plans" ALTER COLUMN "sort_order" SET NOT NULL, ADD CONSTRAINT "UQ_subscription_plans_sort_order" UNIQUE ("sort_order"), ADD CONSTRAINT "CK_subscription_plans_sort_order" CHECK (sort_order >= 0)`);
    await q.query(`ALTER TABLE "subscriptions" ADD "paid_through_at" timestamptz, ADD "pending_plan_id" uuid REFERENCES subscription_plans(id) ON DELETE RESTRICT, ADD "pending_plan_effective_at" timestamptz, ADD "version" integer NOT NULL DEFAULT 0, ADD CONSTRAINT "CK_subscriptions_pending_plan" CHECK ((pending_plan_id IS NULL) = (pending_plan_effective_at IS NULL))`);
    await q.query(`UPDATE subscriptions SET paid_through_at=current_period_ends_at`);
    await q.query(`ALTER TABLE "subscription_payments" ADD "operation" subscription_operation NOT NULL DEFAULT 'LEGACY', ADD "pricing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb, ADD "provider_authority" varchar(160), ADD "payment_intent_id" uuid REFERENCES payment_intents(id) ON DELETE RESTRICT, ADD "idempotency_key" varchar(80)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_subscription_payments_intent" ON subscription_payments(payment_intent_id) WHERE payment_intent_id IS NOT NULL`);
    await q.query(`CREATE UNIQUE INDEX "UQ_subscription_payments_manual_idempotency" ON subscription_payments(subscription_id,idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await q.query(`UPDATE subscription_payments sp SET payment_intent_id=pi.id, provider_authority=pi.authority, provider_reference=COALESCE(pi.provider_reference, sp.provider_reference) FROM payment_intents pi WHERE sp.provider='ZARINPAL' AND sp.provider_reference=pi.authority`);
    await q.query(`CREATE TABLE "subscription_periods" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "subscription_id" uuid NOT NULL REFERENCES subscriptions(id) ON DELETE RESTRICT, "plan_id" uuid NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT, "payment_id" uuid UNIQUE REFERENCES subscription_payments(id) ON DELETE RESTRICT, "starts_at" timestamptz NOT NULL, "ends_at" timestamptz NOT NULL, "price_basis_toman" bigint NOT NULL, "billing_months_basis" smallint NOT NULL, CONSTRAINT "CK_subscription_periods_range" CHECK (ends_at > starts_at), CONSTRAINT "CK_subscription_periods_price" CHECK (price_basis_toman >= 0), CONSTRAINT "CK_subscription_periods_billing" CHECK (billing_months_basis > 0))`);
    await q.query(`CREATE INDEX "IDX_subscription_periods_subscription_range" ON subscription_periods(subscription_id, starts_at, ends_at)`);
    await q.query(`INSERT INTO subscription_periods(subscription_id,plan_id,payment_id,starts_at,ends_at,price_basis_toman,billing_months_basis) SELECT sp.subscription_id,p.id,sp.id,sp.period_started_at,sp.period_ends_at,sp.amount_toman,p.billing_months FROM subscription_payments sp JOIN subscription_plans p ON p.key=sp.plan_key_snapshot WHERE sp.status='PAID' ON CONFLICT (payment_id) DO NOTHING`);
    await q.query(`INSERT INTO subscription_periods(subscription_id,plan_id,starts_at,ends_at,price_basis_toman,billing_months_basis) SELECT s.id,s.plan_id,s.current_period_started_at,s.current_period_ends_at,p.price_toman,p.billing_months FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id WHERE s.current_period_started_at IS NOT NULL AND s.current_period_ends_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM subscription_periods x WHERE x.subscription_id=s.id)`);
    await q.query(`UPDATE subscriptions s SET paid_through_at=x.ends_at FROM (SELECT subscription_id,max(ends_at) ends_at FROM subscription_periods GROUP BY subscription_id) x WHERE x.subscription_id=s.id`);
    await q.query(`ALTER TABLE "payment_intents" ADD "plan_price_snapshot" bigint, ADD "billing_months_snapshot" smallint, ADD "source_plan_key_snapshot" varchar(40), ADD "source_plan_name_snapshot" varchar(100), ADD "source_plan_price_snapshot" bigint, ADD "source_billing_months_snapshot" smallint, ADD "operation" subscription_operation, ADD "pricing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb, ADD "subscription_version_snapshot" integer, ADD "period_started_at" timestamptz, ADD "period_ends_at" timestamptz, ADD "effective_timing" varchar(32)`);
    await q.query(`UPDATE payment_intents pi SET operation='LEGACY', effective_timing='LEGACY', plan_price_snapshot=pi.amount_toman, billing_months_snapshot=p.billing_months FROM subscription_plans p WHERE p.id=pi.plan_id`);
    await q.query(`ALTER TABLE payment_intents ALTER COLUMN plan_price_snapshot SET NOT NULL, ALTER COLUMN billing_months_snapshot SET NOT NULL, ALTER COLUMN operation SET NOT NULL, ALTER COLUMN effective_timing SET NOT NULL`);
    await q.query(`UPDATE payment_intents SET status='EXPIRED' WHERE status IN ('PENDING','VERIFYING')`);
    await q.query(`CREATE UNIQUE INDEX "UQ_payment_intents_one_live_per_tenant" ON payment_intents(coffee_shop_id) WHERE status IN ('PENDING','VERIFYING')`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP INDEX "UQ_payment_intents_one_live_per_tenant"`);
    await q.query(`ALTER TABLE payment_intents DROP COLUMN effective_timing, DROP COLUMN period_ends_at, DROP COLUMN period_started_at, DROP COLUMN subscription_version_snapshot, DROP COLUMN pricing_snapshot, DROP COLUMN operation, DROP COLUMN source_billing_months_snapshot, DROP COLUMN source_plan_price_snapshot, DROP COLUMN source_plan_name_snapshot, DROP COLUMN source_plan_key_snapshot, DROP COLUMN billing_months_snapshot, DROP COLUMN plan_price_snapshot`);
    await q.query(`DROP TABLE subscription_periods`);
    await q.query(`DROP INDEX "UQ_subscription_payments_manual_idempotency"`);
    await q.query(`DROP INDEX "UQ_subscription_payments_intent"`);
    await q.query(`ALTER TABLE subscription_payments DROP COLUMN idempotency_key, DROP COLUMN payment_intent_id, DROP COLUMN provider_authority, DROP COLUMN pricing_snapshot, DROP COLUMN operation`);
    await q.query(`ALTER TABLE subscriptions DROP CONSTRAINT "CK_subscriptions_pending_plan", DROP COLUMN version, DROP COLUMN pending_plan_effective_at, DROP COLUMN pending_plan_id, DROP COLUMN paid_through_at`);
    await q.query(`ALTER TABLE subscription_plans DROP CONSTRAINT "CK_subscription_plans_sort_order", DROP CONSTRAINT "UQ_subscription_plans_sort_order", DROP COLUMN highlighted_feature_keys, DROP COLUMN sort_order, DROP COLUMN description`);
    await q.query(`DROP TYPE subscription_operation`);
  }
}
