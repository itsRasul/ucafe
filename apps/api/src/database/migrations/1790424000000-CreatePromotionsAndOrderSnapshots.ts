import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePromotionsAndOrderSnapshots1790424000000 implements MigrationInterface {
  name = "CreatePromotionsAndOrderSnapshots1790424000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "promotion_reward_type" AS ENUM ('PERCENTAGE','FIXED_AMOUNT','FIXED_PRICE')`);
    await queryRunner.query(`
      CREATE TABLE "promotions" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "is_active" boolean NOT NULL DEFAULT false,
        "start_at" timestamptz,
        "end_at" timestamptz,
        "priority" integer NOT NULL DEFAULT 0,
        "reward_type" promotion_reward_type NOT NULL,
        "reward_value" bigint NOT NULL,
        "created_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "UQ_promotions_tenant_id" UNIQUE ("coffee_shop_id","id"),
        CONSTRAINT "CK_promotions_name" CHECK (length(btrim(name)) > 0),
        CONSTRAINT "CK_promotions_date_range" CHECK (start_at IS NULL OR end_at IS NULL OR end_at > start_at),
        CONSTRAINT "CK_promotions_priority" CHECK (priority BETWEEN 0 AND 1000000),
        CONSTRAINT "CK_promotions_reward_value" CHECK (
          (reward_type = 'PERCENTAGE' AND reward_value BETWEEN 1 AND 100) OR
          (reward_type = 'FIXED_AMOUNT' AND reward_value > 0) OR
          (reward_type = 'FIXED_PRICE' AND reward_value >= 0)
        )
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_promotions_tenant_active_window" ON "promotions" ("coffee_shop_id","is_active","start_at","end_at") WHERE "deleted_at" IS NULL`);
    await queryRunner.query(`
      CREATE TABLE "promotion_targets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL,
        "promotion_id" uuid NOT NULL,
        "menu_item_id" uuid REFERENCES "menu_items"("id") ON DELETE RESTRICT,
        "category_id" uuid REFERENCES "menu_categories"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_promotion_targets_promotion_tenant" FOREIGN KEY ("coffee_shop_id","promotion_id") REFERENCES "promotions"("coffee_shop_id","id") ON DELETE CASCADE,
        CONSTRAINT "CK_promotion_targets_one_target" CHECK ((menu_item_id IS NOT NULL) <> (category_id IS NOT NULL)),
        CONSTRAINT "UQ_promotion_targets_product" UNIQUE ("promotion_id","menu_item_id"),
        CONSTRAINT "UQ_promotion_targets_category" UNIQUE ("promotion_id","category_id")
      )`);
    await queryRunner.query(`CREATE INDEX "IDX_promotion_targets_tenant_product" ON "promotion_targets" ("coffee_shop_id","menu_item_id") WHERE "menu_item_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_promotion_targets_tenant_category" ON "promotion_targets" ("coffee_shop_id","category_id") WHERE "category_id" IS NOT NULL`);
    await queryRunner.query(`
      CREATE FUNCTION enforce_promotion_target_tenant_scope() RETURNS trigger AS $$
      BEGIN
        IF NEW.menu_item_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM menu_items i WHERE i.id = NEW.menu_item_id AND i.coffee_shop_id = NEW.coffee_shop_id
        ) THEN RAISE EXCEPTION 'promotion target item tenant mismatch'; END IF;
        IF NEW.category_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM menu_categories c WHERE c.id = NEW.category_id AND c.coffee_shop_id = NEW.coffee_shop_id
        ) THEN RAISE EXCEPTION 'promotion target category tenant mismatch'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_promotion_targets_tenant_scope" BEFORE INSERT OR UPDATE ON "promotion_targets" FOR EACH ROW EXECUTE FUNCTION enforce_promotion_target_tenant_scope()`);

    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "subtotal_before_discount_toman" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "orders" ADD COLUMN "discount_total_toman" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`UPDATE "orders" SET "subtotal_before_discount_toman" = "total_amount_toman"`);
    await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "CK_orders_discount_totals" CHECK (subtotal_before_discount_toman >= 0 AND discount_total_toman >= 0 AND total_amount_toman = subtotal_before_discount_toman - discount_total_toman)`);

    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "original_unit_price_toman" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "discount_amount_toman" bigint NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_id_snapshot" uuid`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_name_snapshot" varchar(120)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_reward_type_snapshot" varchar(20)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_reward_value_snapshot" bigint`);
    await queryRunner.query(`UPDATE "order_items" SET "original_unit_price_toman" = "unit_price_toman"`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "CK_order_items_discount_snapshot" CHECK (original_unit_price_toman >= 0 AND discount_amount_toman >= 0 AND unit_price_toman + discount_amount_toman = original_unit_price_toman)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "CK_order_items_promotion_snapshot" CHECK ((promotion_id_snapshot IS NULL AND promotion_name_snapshot IS NULL AND promotion_reward_type_snapshot IS NULL AND promotion_reward_value_snapshot IS NULL) OR (promotion_id_snapshot IS NOT NULL AND promotion_name_snapshot IS NOT NULL AND promotion_reward_type_snapshot IS NOT NULL AND promotion_reward_type_snapshot IN ('PERCENTAGE','FIXED_AMOUNT','FIXED_PRICE') AND promotion_reward_value_snapshot IS NOT NULL))`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "CK_order_items_promotion_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "CK_order_items_discount_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_reward_value_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_reward_type_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_name_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_id_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "discount_amount_toman"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "original_unit_price_toman"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "CK_orders_discount_totals"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "discount_total_toman"`);
    await queryRunner.query(`ALTER TABLE "orders" DROP COLUMN "subtotal_before_discount_toman"`);
    await queryRunner.query(`DROP TRIGGER "TRG_promotion_targets_tenant_scope" ON "promotion_targets"`);
    await queryRunner.query(`DROP FUNCTION enforce_promotion_target_tenant_scope()`);
    await queryRunner.query(`DROP TABLE "promotion_targets"`);
    await queryRunner.query(`DROP INDEX "IDX_promotions_tenant_active_window"`);
    await queryRunner.query(`DROP TABLE "promotions"`);
    await queryRunner.query(`DROP TYPE "promotion_reward_type"`);
  }
}
