import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInventoryRecipes1787844000000 implements MigrationInterface {
  name = "CreateInventoryRecipes1787844000000";

  async up(q: QueryRunner) {
    await q.query(`CREATE UNIQUE INDEX "UQ_menu_items_tenant_id" ON menu_items(coffee_shop_id,id)`);
    await q.query(`CREATE UNIQUE INDEX "UQ_menu_variants_tenant_item_id" ON menu_item_variants(coffee_shop_id,item_id,id)`);
    await q.query(`CREATE TYPE inventory_recipe_version_status AS ENUM ('DRAFT','ACTIVE','SUPERSEDED')`);
    await q.query(`CREATE TABLE inventory_recipes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      menu_item_id uuid NOT NULL,
      menu_item_variant_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_recipes_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT FK_inventory_recipes_menu_item_tenant FOREIGN KEY(coffee_shop_id,menu_item_id) REFERENCES menu_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_recipes_menu_variant_tenant FOREIGN KEY(coffee_shop_id,menu_item_id,menu_item_variant_id) REFERENCES menu_item_variants(coffee_shop_id,item_id,id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_recipes_item_target ON inventory_recipes(coffee_shop_id,menu_item_id) WHERE menu_item_variant_id IS NULL`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_recipes_variant_target ON inventory_recipes(coffee_shop_id,menu_item_variant_id) WHERE menu_item_variant_id IS NOT NULL`);
    await q.query(`CREATE TABLE inventory_recipe_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      recipe_id uuid NOT NULL,
      version_number integer NOT NULL,
      status inventory_recipe_version_status NOT NULL DEFAULT 'DRAFT',
      revision integer NOT NULL DEFAULT 0,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      published_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      effective_from timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_recipe_versions_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_recipe_versions_number UNIQUE(coffee_shop_id,recipe_id,version_number),
      CONSTRAINT FK_inventory_recipe_versions_recipe_tenant FOREIGN KEY(coffee_shop_id,recipe_id) REFERENCES inventory_recipes(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT CK_inventory_recipe_version_number CHECK(version_number > 0),
      CONSTRAINT CK_inventory_recipe_version_revision CHECK(revision >= 0),
      CONSTRAINT CK_inventory_recipe_version_publication CHECK((status='DRAFT' AND effective_from IS NULL AND published_by_user_id IS NULL) OR (status IN ('ACTIVE','SUPERSEDED') AND effective_from IS NOT NULL))
    )`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_recipe_versions_active ON inventory_recipe_versions(coffee_shop_id,recipe_id) WHERE status='ACTIVE'`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_recipe_versions_draft ON inventory_recipe_versions(coffee_shop_id,recipe_id) WHERE status='DRAFT'`);
    await q.query(`CREATE INDEX IDX_inventory_recipe_versions_history ON inventory_recipe_versions(coffee_shop_id,recipe_id,version_number DESC)`);
    await q.query(`CREATE TABLE inventory_recipe_components (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      recipe_version_id uuid NOT NULL,
      inventory_item_id uuid NOT NULL,
      inventory_item_name_snapshot varchar(140) NOT NULL,
      quantity_display numeric(20,6) NOT NULL,
      unit varchar(16) NOT NULL,
      quantity_base numeric(20,6) NOT NULL,
      note varchar(240),
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_recipe_components_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_recipe_components_item UNIQUE(coffee_shop_id,recipe_version_id,inventory_item_id),
      CONSTRAINT FK_inventory_recipe_components_version_tenant FOREIGN KEY(coffee_shop_id,recipe_version_id) REFERENCES inventory_recipe_versions(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT FK_inventory_recipe_components_item_tenant FOREIGN KEY(coffee_shop_id,inventory_item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_recipe_component_quantities CHECK(quantity_display > 0 AND quantity_base > 0)
    )`);
    await q.query(`CREATE FUNCTION reject_published_recipe_component_mutation() RETURNS trigger AS $$
      DECLARE version_status inventory_recipe_version_status;
      BEGIN
        SELECT status INTO version_status FROM inventory_recipe_versions WHERE coffee_shop_id=OLD.coffee_shop_id AND id=OLD.recipe_version_id;
        IF version_status IS NOT NULL AND version_status <> 'DRAFT' THEN
          RAISE EXCEPTION 'published recipe components are immutable';
        END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_recipe_components_immutable BEFORE UPDATE OR DELETE ON inventory_recipe_components FOR EACH ROW EXECUTE FUNCTION reject_published_recipe_component_mutation()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE IF EXISTS inventory_recipe_components`);
    await q.query(`DROP FUNCTION IF EXISTS reject_published_recipe_component_mutation()`);
    await q.query(`DROP TABLE IF EXISTS inventory_recipe_versions`);
    await q.query(`DROP TABLE IF EXISTS inventory_recipes`);
    await q.query(`DROP TYPE IF EXISTS inventory_recipe_version_status`);
    await q.query(`DROP INDEX IF EXISTS UQ_menu_variants_tenant_item_id`);
    await q.query(`DROP INDEX IF EXISTS UQ_menu_items_tenant_id`);
  }
}
