import { MigrationInterface, QueryRunner } from "typeorm";

export class AddClientOrderingAndPlanModules1787792400000 implements MigrationInterface {
  name = "AddClientOrderingAndPlanModules1787792400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "otp_purpose" ADD VALUE IF NOT EXISTS 'CLIENT_LOGIN'`);
    await queryRunner.query(`ALTER TABLE "otp_challenges" ADD COLUMN "coffee_shop_id" uuid REFERENCES "coffee_shops"("id") ON DELETE CASCADE`);
    await queryRunner.query(`CREATE INDEX "IDX_otp_challenges_tenant_phone_created" ON "otp_challenges" ("coffee_shop_id","phone_hash","created_at")`);

    await queryRunner.query(`
      UPDATE "subscription_plans"
      SET "features" = COALESCE("features", '{}'::jsonb) || '{"menu":true,"reservations":true,"onlineOrdering":false}'::jsonb
      WHERE "key" = 'silver'
    `);
    await queryRunner.query(`
      UPDATE "subscription_plans"
      SET "status" = 'ACTIVE',
          "features" = COALESCE("features", '{}'::jsonb) || '{"menu":true,"reservations":true,"onlineOrdering":true}'::jsonb
      WHERE "key" = 'golden'
    `);

    await queryRunner.query(`
      INSERT INTO "permissions" ("scope","key","description") VALUES
      ('TENANT','orders.read','View online orders'),
      ('TENANT','orders.manage','Manage online orders and ordering settings')
      ON CONFLICT ("key") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id","permission_id")
      SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p
      WHERE r.scope='TENANT' AND r.key='owner' AND p.key IN ('orders.read','orders.manage')
      ON CONFLICT DO NOTHING
    `);

    await queryRunner.query(`CREATE TYPE "client_status" AS ENUM ('ACTIVE','BLOCKED')`);
    await queryRunner.query(`
      CREATE TABLE "clients" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "first_name" varchar(80) NOT NULL,
        "last_name" varchar(80) NOT NULL,
        "phone" varchar(16) NOT NULL,
        "status" client_status NOT NULL DEFAULT 'ACTIVE',
        "phone_verified_at" timestamptz,
        "last_authenticated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_clients_tenant_phone" UNIQUE ("coffee_shop_id","phone"),
        CONSTRAINT "CK_clients_phone_e164" CHECK (phone ~ '^\\+[1-9][0-9]{7,14}$')
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_clients_tenant_created" ON "clients" ("coffee_shop_id","created_at")`);

    await queryRunner.query(`
      CREATE TABLE "client_auth_sessions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "token_family_id" uuid NOT NULL,
        "refresh_token_hash" char(64) NOT NULL,
        "parent_session_id" uuid REFERENCES "client_auth_sessions"("id") ON DELETE SET NULL,
        "replaced_by_session_id" uuid REFERENCES "client_auth_sessions"("id") ON DELETE SET NULL,
        "ip_hash" char(64),
        "user_agent_hash" char(64),
        "expires_at" timestamptz NOT NULL,
        "last_used_at" timestamptz,
        "rotated_at" timestamptz,
        "revoked_at" timestamptz,
        "compromised_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_client_auth_sessions_refresh_hash" UNIQUE ("refresh_token_hash"),
        CONSTRAINT "UQ_client_auth_sessions_replacement" UNIQUE ("replaced_by_session_id"),
        CONSTRAINT "CK_client_auth_sessions_expiry" CHECK (expires_at > created_at)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_client_auth_sessions_client_active" ON "client_auth_sessions" ("client_id") WHERE revoked_at IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_client_auth_sessions_tenant_active" ON "client_auth_sessions" ("coffee_shop_id") WHERE revoked_at IS NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_client_auth_sessions_active_family" ON "client_auth_sessions" ("token_family_id") WHERE revoked_at IS NULL`);

    await queryRunner.query(`
      CREATE TABLE "client_addresses" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE CASCADE,
        "label" varchar(80),
        "address_line" varchar(700) NOT NULL,
        "is_default" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_client_addresses_client_active" ON "client_addresses" ("coffee_shop_id","client_id") WHERE deleted_at IS NULL`);

    await queryRunner.query(`CREATE TYPE "order_status" AS ENUM ('UNDER_REVIEW','PREPARING','READY','OUT_FOR_DELIVERY','DELIVERED')`);
    await queryRunner.query(`CREATE TYPE "order_payment_method" AS ENUM ('OFFLINE')`);
    await queryRunner.query(`CREATE TYPE "order_delivery_method" AS ENUM ('PICKUP','COURIER')`);
    await queryRunner.query(`
      CREATE TABLE "online_ordering_settings" (
        "coffee_shop_id" uuid PRIMARY KEY REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "pickup_enabled" boolean NOT NULL DEFAULT true,
        "courier_enabled" boolean NOT NULL DEFAULT false,
        "offline_payment_enabled" boolean NOT NULL DEFAULT true,
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`INSERT INTO "online_ordering_settings" ("coffee_shop_id") SELECT "id" FROM "coffee_shops" ON CONFLICT DO NOTHING`);

    await queryRunner.query(`
      CREATE TABLE "orders" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        "client_id" uuid NOT NULL REFERENCES "clients"("id") ON DELETE RESTRICT,
        "branch_id" uuid REFERENCES "branches"("id") ON DELETE SET NULL,
        "status" order_status NOT NULL DEFAULT 'UNDER_REVIEW',
        "payment_method" order_payment_method NOT NULL DEFAULT 'OFFLINE',
        "delivery_method" order_delivery_method NOT NULL,
        "delivery_address_id" uuid REFERENCES "client_addresses"("id") ON DELETE SET NULL,
        "delivery_address_snapshot" jsonb,
        "total_amount_toman" bigint NOT NULL,
        "idempotency_key" varchar(80) NOT NULL,
        "customer_note" varchar(500),
        "status_changed_at" timestamptz,
        "status_changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_orders_client_idempotency" UNIQUE ("coffee_shop_id","client_id","idempotency_key"),
        CONSTRAINT "CK_orders_total" CHECK (total_amount_toman >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_orders_tenant_created" ON "orders" ("coffee_shop_id","created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX "IDX_orders_tenant_status_created" ON "orders" ("coffee_shop_id","status","created_at" DESC)`);

    await queryRunner.query(`
      CREATE TABLE "order_items" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        "order_id" uuid NOT NULL REFERENCES "orders"("id") ON DELETE CASCADE,
        "menu_item_id" uuid REFERENCES "menu_items"("id") ON DELETE SET NULL,
        "menu_item_variant_id" uuid REFERENCES "menu_item_variants"("id") ON DELETE SET NULL,
        "item_name" varchar(140) NOT NULL,
        "variant_name" varchar(80),
        "unit_price_toman" bigint NOT NULL,
        "quantity" smallint NOT NULL,
        "line_total_toman" bigint NOT NULL,
        CONSTRAINT "CK_order_items_quantity" CHECK (quantity > 0),
        CONSTRAINT "CK_order_items_amounts" CHECK (unit_price_toman >= 0 AND line_total_toman >= 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_order_items_order" ON "order_items" ("order_id")`);

    await queryRunner.query(`CREATE FUNCTION enforce_client_address_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'client address tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_client_addresses_tenant_scope" BEFORE INSERT OR UPDATE ON "client_addresses" FOR EACH ROW EXECUTE FUNCTION enforce_client_address_tenant_scope()`);
    await queryRunner.query(`CREATE FUNCTION enforce_client_session_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'client session tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_client_auth_sessions_tenant_scope" BEFORE INSERT OR UPDATE ON "client_auth_sessions" FOR EACH ROW EXECUTE FUNCTION enforce_client_session_tenant_scope()`);
    await queryRunner.query(`CREATE FUNCTION enforce_order_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id=NEW.client_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'order client tenant mismatch'; END IF; IF NEW.branch_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'order branch tenant mismatch'; END IF; IF NEW.delivery_address_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM client_addresses a WHERE a.id=NEW.delivery_address_id AND a.client_id=NEW.client_id AND a.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'order address tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_orders_tenant_scope" BEFORE INSERT OR UPDATE ON "orders" FOR EACH ROW EXECUTE FUNCTION enforce_order_tenant_scope()`);
    await queryRunner.query(`CREATE FUNCTION enforce_order_item_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM orders o WHERE o.id=NEW.order_id AND o.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'order item tenant mismatch'; END IF; IF NEW.menu_item_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_items i WHERE i.id=NEW.menu_item_id AND i.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'order item menu tenant mismatch'; END IF; IF NEW.menu_item_variant_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM menu_item_variants v WHERE v.id=NEW.menu_item_variant_id AND v.coffee_shop_id=NEW.coffee_shop_id AND (NEW.menu_item_id IS NULL OR v.item_id=NEW.menu_item_id)) THEN RAISE EXCEPTION 'order item variant tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_order_items_tenant_scope" BEFORE INSERT OR UPDATE ON "order_items" FOR EACH ROW EXECUTE FUNCTION enforce_order_item_tenant_scope()`);

    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM reservations r JOIN users u ON u.id=r.customer_user_id WHERE u.phone IS NULL) THEN RAISE EXCEPTION 'cannot migrate reservation customers without verified phone'; END IF; END $$`);
    await queryRunner.query(`ALTER TABLE "reservations" ADD COLUMN "client_id" uuid`);
    await queryRunner.query(`
      WITH source AS (
        SELECT DISTINCT ON (r.coffee_shop_id, u.phone)
          r.coffee_shop_id,
          u.phone,
          COALESCE(NULLIF(trim(r.contact_name), ''), 'مهمان') AS contact_name,
          COALESCE(u.phone_verified_at, now()) AS phone_verified_at
        FROM reservations r
        JOIN users u ON u.id = r.customer_user_id
        ORDER BY r.coffee_shop_id, u.phone, r.created_at
      )
      INSERT INTO clients (coffee_shop_id, first_name, last_name, phone, phone_verified_at)
      SELECT coffee_shop_id,
        left(split_part(contact_name, ' ', 1), 80),
        left(CASE WHEN position(' ' in contact_name) > 0 THEN regexp_replace(contact_name, '^\\S+\\s*', '') ELSE '' END, 80),
        phone,
        phone_verified_at
      FROM source
      ON CONFLICT ("coffee_shop_id","phone") DO NOTHING
    `);
    await queryRunner.query(`UPDATE reservations r SET client_id = c.id FROM users u, clients c WHERE u.id = r.customer_user_id AND c.coffee_shop_id = r.coffee_shop_id AND c.phone = u.phone`);
    await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM reservations WHERE client_id IS NULL) THEN RAISE EXCEPTION 'reservation client backfill failed'; END IF; END $$`);
    await queryRunner.query(`ALTER TABLE "reservations" ALTER COLUMN "client_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_reservations_client" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE INDEX "IDX_reservations_tenant_client" ON "reservations" ("coffee_shop_id","client_id")`);
    await queryRunner.query(`ALTER TABLE "reservations" DROP COLUMN "customer_user_id"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "reservations" ADD COLUMN "customer_user_id" uuid`);
    await queryRunner.query(`UPDATE reservations r SET customer_user_id = u.id FROM clients c JOIN users u ON u.phone = c.phone WHERE c.id = r.client_id`);
    await queryRunner.query(`ALTER TABLE "reservations" ALTER COLUMN "customer_user_id" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "reservations" ADD CONSTRAINT "FK_reservations_customer_user" FOREIGN KEY ("customer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT`);
    await queryRunner.query(`DROP INDEX "IDX_reservations_tenant_client"`);
    await queryRunner.query(`ALTER TABLE "reservations" DROP CONSTRAINT "FK_reservations_client"`);
    await queryRunner.query(`ALTER TABLE "reservations" DROP COLUMN "client_id"`);

    await queryRunner.query(`DROP TRIGGER "TRG_order_items_tenant_scope" ON "order_items"`);
    await queryRunner.query(`DROP FUNCTION enforce_order_item_tenant_scope`);
    await queryRunner.query(`DROP TRIGGER "TRG_orders_tenant_scope" ON "orders"`);
    await queryRunner.query(`DROP FUNCTION enforce_order_tenant_scope`);
    await queryRunner.query(`DROP TRIGGER "TRG_client_auth_sessions_tenant_scope" ON "client_auth_sessions"`);
    await queryRunner.query(`DROP FUNCTION enforce_client_session_tenant_scope`);
    await queryRunner.query(`DROP TRIGGER "TRG_client_addresses_tenant_scope" ON "client_addresses"`);
    await queryRunner.query(`DROP FUNCTION enforce_client_address_tenant_scope`);

    await queryRunner.query(`DROP TABLE "order_items"`);
    await queryRunner.query(`DROP TABLE "orders"`);
    await queryRunner.query(`DROP TABLE "online_ordering_settings"`);
    await queryRunner.query(`DROP TYPE "order_delivery_method"`);
    await queryRunner.query(`DROP TYPE "order_payment_method"`);
    await queryRunner.query(`DROP TYPE "order_status"`);
    await queryRunner.query(`DROP TABLE "client_addresses"`);
    await queryRunner.query(`DROP TABLE "client_auth_sessions"`);
    await queryRunner.query(`DROP TABLE "clients"`);
    await queryRunner.query(`DROP TYPE "client_status"`);
    await queryRunner.query(`DELETE FROM "role_permissions" WHERE "permission_id" IN (SELECT id FROM "permissions" WHERE "key" IN ('orders.read','orders.manage'))`);
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key" IN ('orders.read','orders.manage')`);
    await queryRunner.query(`DROP INDEX "IDX_otp_challenges_tenant_phone_created"`);
    await queryRunner.query(`ALTER TABLE "otp_challenges" DROP COLUMN "coffee_shop_id"`);
  }
}
