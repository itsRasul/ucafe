import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMediaFoundation1787770800000 implements MigrationInterface {
  name = "CreateMediaFoundation1787770800000";
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "media_asset_kind" AS ENUM ('LOGO','HERO','GALLERY')`);
    await queryRunner.query(`
      CREATE TABLE "media_assets" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE CASCADE,
        "kind" media_asset_kind NOT NULL,
        "original_filename" varchar(180) NOT NULL,
        "source_media_type" varchar(40) NOT NULL,
        "source_size_bytes" integer NOT NULL,
        "source_width" integer NOT NULL,
        "source_height" integer NOT NULL,
        "focal_x" numeric(5,4) NOT NULL DEFAULT 0.5,
        "focal_y" numeric(5,4) NOT NULL DEFAULT 0.5,
        "sort_order" smallint NOT NULL DEFAULT 0,
        "storage_prefix" varchar(220) NOT NULL UNIQUE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "deleted_at" timestamptz,
        CONSTRAINT "CK_media_assets_source" CHECK (source_size_bytes > 0 AND source_size_bytes <= 8388608 AND source_width > 0 AND source_height > 0),
        CONSTRAINT "CK_media_assets_focal" CHECK (focal_x BETWEEN 0 AND 1 AND focal_y BETWEEN 0 AND 1),
        CONSTRAINT "CK_media_assets_sort" CHECK (sort_order BETWEEN 0 AND 7)
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX "uq_media_assets_single_slot" ON "media_assets" ("coffee_shop_id", "kind") WHERE "kind" IN ('LOGO','HERO') AND "deleted_at" IS NULL`);
    await queryRunner.query(`CREATE INDEX "idx_media_assets_tenant_gallery" ON "media_assets" ("coffee_shop_id", "kind", "sort_order") WHERE "deleted_at" IS NULL`);
    await queryRunner.query(`
      CREATE FUNCTION enforce_media_asset_scope_and_limit() RETURNS trigger AS $$
      BEGIN
        IF NEW.storage_prefix <> 'tenants/' || NEW.coffee_shop_id::text || '/' || NEW.id::text THEN RAISE EXCEPTION 'media storage prefix must match tenant and asset'; END IF;
        IF NEW.kind = 'GALLERY' AND NEW.deleted_at IS NULL AND (SELECT count(*) FROM media_assets WHERE coffee_shop_id = NEW.coffee_shop_id AND kind = 'GALLERY' AND deleted_at IS NULL AND id <> NEW.id) >= 8 THEN RAISE EXCEPTION 'gallery is limited to 8 active images'; END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`CREATE TRIGGER "trg_media_asset_scope_and_limit" BEFORE INSERT OR UPDATE ON "media_assets" FOR EACH ROW EXECUTE FUNCTION enforce_media_asset_scope_and_limit()`);
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "trg_media_asset_scope_and_limit" ON "media_assets"`);
    await queryRunner.query(`DROP FUNCTION enforce_media_asset_scope_and_limit`);
    await queryRunner.query(`DROP TABLE "media_assets"`);
    await queryRunner.query(`DROP TYPE "media_asset_kind"`);
  }
}
