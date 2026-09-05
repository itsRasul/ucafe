import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMenuItemMedia1787781600000 implements MigrationInterface {
  name = "AddMenuItemMedia1787781600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "uq_media_assets_single_slot"`);
    await queryRunner.query(`ALTER TABLE "media_assets" ALTER COLUMN "kind" TYPE varchar USING "kind"::text`);
    await queryRunner.query(`DROP TYPE "media_asset_kind"`);
    await queryRunner.query(`CREATE TYPE "media_asset_kind" AS ENUM ('LOGO','HERO','GALLERY','MENU_ITEM')`);
    await queryRunner.query(`ALTER TABLE "media_assets" ALTER COLUMN "kind" TYPE "media_asset_kind" USING "kind"::"media_asset_kind"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_media_assets_single_slot" ON "media_assets" ("coffee_shop_id", "kind") WHERE "kind" IN ('LOGO','HERO') AND "deleted_at" IS NULL`);
    await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "menu_item_id" uuid REFERENCES "menu_items"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "media_assets" ADD CONSTRAINT "CK_media_assets_menu_item_kind" CHECK ((kind = 'MENU_ITEM' AND menu_item_id IS NOT NULL) OR (kind <> 'MENU_ITEM' AND menu_item_id IS NULL))`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_media_assets_menu_item" ON "media_assets" ("menu_item_id") WHERE "kind" = 'MENU_ITEM' AND "deleted_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "idx_media_assets_tenant_menu_item" ON "media_assets" ("coffee_shop_id", "menu_item_id") WHERE "kind" = 'MENU_ITEM' AND "deleted_at" IS NULL`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_media_asset_scope_and_limit() RETURNS trigger AS $$
      BEGIN
        IF NEW.storage_prefix <> 'tenants/' || NEW.coffee_shop_id::text || '/' || NEW.id::text THEN RAISE EXCEPTION 'media storage prefix must match tenant and asset'; END IF;
        IF NEW.kind = 'GALLERY' AND NEW.deleted_at IS NULL AND (SELECT count(*) FROM media_assets WHERE coffee_shop_id = NEW.coffee_shop_id AND kind = 'GALLERY' AND deleted_at IS NULL AND id <> NEW.id) >= 8 THEN RAISE EXCEPTION 'gallery is limited to 8 active images'; END IF;
        IF NEW.kind = 'MENU_ITEM' AND NOT EXISTS (SELECT 1 FROM menu_items WHERE id = NEW.menu_item_id AND coffee_shop_id = NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu item media must match tenant'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "media_assets" WHERE "kind" = 'MENU_ITEM'`);
    await queryRunner.query(`DROP INDEX "idx_media_assets_tenant_menu_item"`);
    await queryRunner.query(`DROP INDEX "uq_media_assets_menu_item"`);
    await queryRunner.query(`ALTER TABLE "media_assets" DROP CONSTRAINT "CK_media_assets_menu_item_kind"`);
    await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "menu_item_id"`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION enforce_media_asset_scope_and_limit() RETURNS trigger AS $$
      BEGIN
        IF NEW.storage_prefix <> 'tenants/' || NEW.coffee_shop_id::text || '/' || NEW.id::text THEN RAISE EXCEPTION 'media storage prefix must match tenant and asset'; END IF;
        IF NEW.kind = 'GALLERY' AND NEW.deleted_at IS NULL AND (SELECT count(*) FROM media_assets WHERE coffee_shop_id = NEW.coffee_shop_id AND kind = 'GALLERY' AND deleted_at IS NULL AND id <> NEW.id) >= 8 THEN RAISE EXCEPTION 'gallery is limited to 8 active images'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`DROP INDEX "uq_media_assets_single_slot"`);
    await queryRunner.query(`ALTER TABLE "media_assets" ALTER COLUMN "kind" TYPE varchar USING "kind"::text`);
    await queryRunner.query(`DROP TYPE "media_asset_kind"`);
    await queryRunner.query(`CREATE TYPE "media_asset_kind" AS ENUM ('LOGO','HERO','GALLERY')`);
    await queryRunner.query(`ALTER TABLE "media_assets" ALTER COLUMN "kind" TYPE "media_asset_kind" USING "kind"::"media_asset_kind"`);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_media_assets_single_slot" ON "media_assets" ("coffee_shop_id", "kind") WHERE "kind" IN ('LOGO','HERO') AND "deleted_at" IS NULL`);
  }
}
