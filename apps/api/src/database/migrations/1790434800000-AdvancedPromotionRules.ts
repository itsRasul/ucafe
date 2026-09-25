import { MigrationInterface, QueryRunner } from "typeorm";

export class AdvancedPromotionRules1790434800000 implements MigrationInterface {
  name = "AdvancedPromotionRules1790434800000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "promotion_advanced_type" AS ENUM ('BUY_X_GET_Y','BUNDLE','QUANTITY_TIER')`);
    await queryRunner.query(`CREATE TYPE "promotion_rule_group_role" AS ENUM ('BUY','GET','BUNDLE_ITEM','QUANTITY_TARGET')`);
    await queryRunner.query(`CREATE TABLE "promotion_advanced_rules" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "coffee_shop_id" uuid NOT NULL,
      "promotion_id" uuid NOT NULL,
      "rule_type" promotion_advanced_type NOT NULL,
      "repeatable" boolean NOT NULL DEFAULT true,
      CONSTRAINT "UQ_promotion_advanced_rules_promotion" UNIQUE ("coffee_shop_id","promotion_id"),
      CONSTRAINT "UQ_promotion_advanced_rules_tenant_id" UNIQUE ("coffee_shop_id","id"),
      CONSTRAINT "FK_promotion_advanced_rules_promotion" FOREIGN KEY ("coffee_shop_id","promotion_id") REFERENCES "promotions" ("coffee_shop_id","id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "promotion_rule_groups" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "coffee_shop_id" uuid NOT NULL,
      "rule_id" uuid NOT NULL,
      "role" promotion_rule_group_role NOT NULL,
      "position" smallint NOT NULL DEFAULT 0,
      "quantity" smallint NOT NULL,
      CONSTRAINT "UQ_promotion_rule_groups_role" UNIQUE ("rule_id","role","position"),
      CONSTRAINT "UQ_promotion_rule_groups_tenant_id" UNIQUE ("coffee_shop_id","id"),
      CONSTRAINT "CK_promotion_rule_groups_quantity" CHECK ("quantity" BETWEEN 1 AND 50),
      CONSTRAINT "FK_promotion_rule_groups_rule" FOREIGN KEY ("coffee_shop_id","rule_id") REFERENCES "promotion_advanced_rules" ("coffee_shop_id","id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE TABLE "promotion_rule_targets" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "coffee_shop_id" uuid NOT NULL,
      "group_id" uuid NOT NULL,
      "menu_item_id" uuid REFERENCES "menu_items"("id") ON DELETE RESTRICT,
      "category_id" uuid REFERENCES "menu_categories"("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_promotion_rule_targets_group" FOREIGN KEY ("coffee_shop_id","group_id") REFERENCES "promotion_rule_groups" ("coffee_shop_id","id") ON DELETE CASCADE,
      CONSTRAINT "CK_promotion_rule_targets_one_target" CHECK (("menu_item_id" IS NOT NULL) <> ("category_id" IS NOT NULL)),
      CONSTRAINT "UQ_promotion_rule_targets_product" UNIQUE ("group_id","menu_item_id"),
      CONSTRAINT "UQ_promotion_rule_targets_category" UNIQUE ("group_id","category_id")
    )`);
    await queryRunner.query(`CREATE INDEX "IDX_promotion_rule_targets_tenant_product" ON "promotion_rule_targets" ("coffee_shop_id","menu_item_id") WHERE "menu_item_id" IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX "IDX_promotion_rule_targets_tenant_category" ON "promotion_rule_targets" ("coffee_shop_id","category_id") WHERE "category_id" IS NOT NULL`);
    await queryRunner.query(`CREATE FUNCTION enforce_promotion_rule_target_tenant_scope() RETURNS trigger AS $$
      BEGIN
        IF NEW.menu_item_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM menu_items i WHERE i.id = NEW.menu_item_id AND i.coffee_shop_id = NEW.coffee_shop_id
        ) THEN RAISE EXCEPTION 'promotion rule target item tenant mismatch'; END IF;
        IF NEW.category_id IS NOT NULL AND NOT EXISTS (
          SELECT 1 FROM menu_categories c WHERE c.id = NEW.category_id AND c.coffee_shop_id = NEW.coffee_shop_id
        ) THEN RAISE EXCEPTION 'promotion rule target category tenant mismatch'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_promotion_rule_targets_tenant_scope" BEFORE INSERT OR UPDATE ON "promotion_rule_targets" FOR EACH ROW EXECUTE FUNCTION enforce_promotion_rule_target_tenant_scope()`);
    await queryRunner.query(`CREATE TABLE "promotion_quantity_tiers" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "coffee_shop_id" uuid NOT NULL,
      "rule_id" uuid NOT NULL,
      "minimum_quantity" smallint NOT NULL,
      "reward_type" promotion_reward_type NOT NULL,
      "reward_value" bigint NOT NULL,
      CONSTRAINT "UQ_promotion_quantity_tiers_threshold" UNIQUE ("rule_id","minimum_quantity"),
      CONSTRAINT "CK_promotion_quantity_tiers_threshold" CHECK ("minimum_quantity" BETWEEN 1 AND 50),
      CONSTRAINT "CK_promotion_quantity_tiers_reward" CHECK (("reward_type" = 'PERCENTAGE' AND "reward_value" BETWEEN 1 AND 100) OR ("reward_type" = 'FIXED_AMOUNT' AND "reward_value" > 0)),
      CONSTRAINT "FK_promotion_quantity_tiers_rule" FOREIGN KEY ("coffee_shop_id","rule_id") REFERENCES "promotion_advanced_rules" ("coffee_shop_id","id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_type_snapshot" varchar(30)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_allocation_type_snapshot" varchar(30)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD COLUMN "promotion_rule_snapshot" varchar(500)`);
    await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "CK_order_items_advanced_promotion_snapshot" CHECK (
      ("promotion_type_snapshot" IS NULL AND "promotion_allocation_type_snapshot" IS NULL AND "promotion_rule_snapshot" IS NULL) OR
      ("promotion_id_snapshot" IS NOT NULL AND "promotion_type_snapshot" IN ('BUY_X_GET_Y','BUNDLE','QUANTITY_TIER') AND "promotion_allocation_type_snapshot" IN ('GET','BUNDLE','QUANTITY_TIER') AND "promotion_rule_snapshot" IS NOT NULL)
    )`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "CK_order_items_advanced_promotion_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_rule_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_allocation_type_snapshot"`);
    await queryRunner.query(`ALTER TABLE "order_items" DROP COLUMN "promotion_type_snapshot"`);
    await queryRunner.query(`DROP TABLE "promotion_quantity_tiers"`);
    await queryRunner.query(`DROP TRIGGER "TRG_promotion_rule_targets_tenant_scope" ON "promotion_rule_targets"`);
    await queryRunner.query(`DROP FUNCTION enforce_promotion_rule_target_tenant_scope()`);
    await queryRunner.query(`DROP INDEX "IDX_promotion_rule_targets_tenant_category"`);
    await queryRunner.query(`DROP INDEX "IDX_promotion_rule_targets_tenant_product"`);
    await queryRunner.query(`DROP TABLE "promotion_rule_targets"`);
    await queryRunner.query(`DROP TABLE "promotion_rule_groups"`);
    await queryRunner.query(`DROP TABLE "promotion_advanced_rules"`);
    await queryRunner.query(`DROP TYPE "promotion_rule_group_role"`);
    await queryRunner.query(`DROP TYPE "promotion_advanced_type"`);
  }
}
