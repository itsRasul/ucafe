import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateMenuFoundation1787760000000 implements MigrationInterface {
  name = "CreateMenuFoundation1787760000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE "menu_categories" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,"name" varchar(100) NOT NULL,"description" varchar(240),"sort_order" integer NOT NULL DEFAULT 0,"is_active" boolean NOT NULL DEFAULT true,"created_at" timestamptz NOT NULL DEFAULT now(),"updated_at" timestamptz NOT NULL DEFAULT now(),"deleted_at" timestamptz,CONSTRAINT "UQ_menu_categories_tenant_name" UNIQUE ("coffee_shop_id","name"))`);
    await queryRunner.query(`CREATE INDEX "IDX_menu_categories_tenant_order" ON "menu_categories" ("coffee_shop_id","sort_order")`);
    await queryRunner.query(`CREATE TABLE "menu_items" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,"category_id" uuid NOT NULL REFERENCES "menu_categories"("id") ON DELETE RESTRICT,"name" varchar(140) NOT NULL,"description" varchar(500),"base_price_toman" bigint,"is_available" boolean NOT NULL DEFAULT true,"is_featured" boolean NOT NULL DEFAULT false,"sort_order" integer NOT NULL DEFAULT 0,"created_at" timestamptz NOT NULL DEFAULT now(),"updated_at" timestamptz NOT NULL DEFAULT now(),"deleted_at" timestamptz,CONSTRAINT "CK_menu_items_price" CHECK (base_price_toman IS NULL OR base_price_toman >= 0))`);
    await queryRunner.query(`CREATE INDEX "IDX_menu_items_tenant_category_order" ON "menu_items" ("coffee_shop_id","category_id","sort_order")`);
    await queryRunner.query(`CREATE TABLE "menu_item_variants" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,"item_id" uuid NOT NULL REFERENCES "menu_items"("id") ON DELETE CASCADE,"name" varchar(80) NOT NULL,"price_toman" bigint NOT NULL,"is_default" boolean NOT NULL DEFAULT false,"is_available" boolean NOT NULL DEFAULT true,"sort_order" integer NOT NULL DEFAULT 0,CONSTRAINT "UQ_menu_item_variants_item_name" UNIQUE ("item_id","name"),CONSTRAINT "CK_menu_item_variants_price" CHECK (price_toman >= 0))`);
    await queryRunner.query(`CREATE INDEX "IDX_menu_item_variants_tenant_item_order" ON "menu_item_variants" ("coffee_shop_id","item_id","sort_order")`);
    await queryRunner.query(`CREATE UNIQUE INDEX "UQ_menu_item_variants_default" ON "menu_item_variants" ("item_id") WHERE is_default = true`);
    await queryRunner.query(`CREATE FUNCTION enforce_menu_item_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM menu_categories c WHERE c.id=NEW.category_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu item category tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE FUNCTION enforce_menu_variant_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM menu_items i WHERE i.id=NEW.item_id AND i.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu variant item tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_items_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_items" FOR EACH ROW EXECUTE FUNCTION enforce_menu_item_tenant_scope()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_variants_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_item_variants" FOR EACH ROW EXECUTE FUNCTION enforce_menu_variant_tenant_scope()`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "menu_item_variants"`);
    await queryRunner.query(`DROP TABLE "menu_items"`);
    await queryRunner.query(`DROP TABLE "menu_categories"`);
    await queryRunner.query(`DROP FUNCTION enforce_menu_item_tenant_scope`);
    await queryRunner.query(`DROP FUNCTION enforce_menu_variant_tenant_scope`);
  }
}
