import { MigrationInterface, QueryRunner } from "typeorm";

export class FixMenuTenantScopeTriggers1787760600000 implements MigrationInterface {
  name = "FixMenuTenantScopeTriggers1787760600000";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "TRG_menu_items_tenant_scope" ON "menu_items"`);
    await queryRunner.query(`DROP TRIGGER "TRG_menu_variants_tenant_scope" ON "menu_item_variants"`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_menu_tenant_scope`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_menu_item_tenant_scope`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS enforce_menu_variant_tenant_scope`);
    await queryRunner.query(`CREATE FUNCTION enforce_menu_item_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM menu_categories c WHERE c.id=NEW.category_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu item category tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE FUNCTION enforce_menu_variant_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM menu_items i WHERE i.id=NEW.item_id AND i.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu variant item tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_items_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_items" FOR EACH ROW EXECUTE FUNCTION enforce_menu_item_tenant_scope()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_variants_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_item_variants" FOR EACH ROW EXECUTE FUNCTION enforce_menu_variant_tenant_scope()`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TRIGGER "TRG_menu_items_tenant_scope" ON "menu_items"`);
    await queryRunner.query(`DROP TRIGGER "TRG_menu_variants_tenant_scope" ON "menu_item_variants"`);
    await queryRunner.query(`DROP FUNCTION enforce_menu_item_tenant_scope`);
    await queryRunner.query(`DROP FUNCTION enforce_menu_variant_tenant_scope`);
    await queryRunner.query(`CREATE FUNCTION enforce_menu_tenant_scope() RETURNS trigger AS $$ BEGIN IF TG_TABLE_NAME = 'menu_items' AND NOT EXISTS (SELECT 1 FROM menu_categories c WHERE c.id=NEW.category_id AND c.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu item category tenant mismatch'; END IF; IF TG_TABLE_NAME = 'menu_item_variants' AND NOT EXISTS (SELECT 1 FROM menu_items i WHERE i.id=NEW.item_id AND i.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'menu variant item tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_items_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_items" FOR EACH ROW EXECUTE FUNCTION enforce_menu_tenant_scope()`);
    await queryRunner.query(`CREATE TRIGGER "TRG_menu_variants_tenant_scope" BEFORE INSERT OR UPDATE ON "menu_item_variants" FOR EACH ROW EXECUTE FUNCTION enforce_menu_tenant_scope()`);
  }
}
