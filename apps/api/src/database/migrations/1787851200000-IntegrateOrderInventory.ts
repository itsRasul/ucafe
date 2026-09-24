import { MigrationInterface, QueryRunner } from "typeorm";

export class IntegrateOrderInventory1787851200000 implements MigrationInterface {
  name = "IntegrateOrderInventory1787851200000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE order_items ADD CONSTRAINT UQ_order_items_tenant_id UNIQUE(coffee_shop_id,id)`);
    await q.query(`ALTER TABLE inventory_stock_movements
      ADD CONSTRAINT UQ_inventory_movements_tenant_id UNIQUE(coffee_shop_id,id),
      ADD COLUMN order_item_id uuid,
      ADD COLUMN recipe_version_id uuid,
      ADD COLUMN recipe_component_id uuid,
      ADD COLUMN reversal_of_movement_id uuid,
      ADD CONSTRAINT FK_inventory_movement_order_item_tenant FOREIGN KEY(coffee_shop_id,order_item_id) REFERENCES order_items(coffee_shop_id,id) ON DELETE RESTRICT,
      ADD CONSTRAINT FK_inventory_movement_recipe_version_tenant FOREIGN KEY(coffee_shop_id,recipe_version_id) REFERENCES inventory_recipe_versions(coffee_shop_id,id) ON DELETE RESTRICT,
      ADD CONSTRAINT FK_inventory_movement_recipe_component_tenant FOREIGN KEY(coffee_shop_id,recipe_component_id) REFERENCES inventory_recipe_components(coffee_shop_id,id) ON DELETE RESTRICT,
      ADD CONSTRAINT FK_inventory_movement_reversal_tenant FOREIGN KEY(coffee_shop_id,reversal_of_movement_id) REFERENCES inventory_stock_movements(coffee_shop_id,id) ON DELETE RESTRICT,
      ADD CONSTRAINT CK_inventory_movement_order_consumption CHECK(type <> 'SALE_CONSUMPTION' OR source_type <> 'ORDER_CONSUMPTION' OR (quantity_base < 0 AND source_id IS NOT NULL AND order_item_id IS NOT NULL AND recipe_version_id IS NOT NULL AND recipe_component_id IS NOT NULL)),
      ADD CONSTRAINT CK_inventory_movement_reversal_ref CHECK((type='SALE_REVERSAL') = (reversal_of_movement_id IS NOT NULL))`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_movements_order_consumption ON inventory_stock_movements(coffee_shop_id,source_id,order_item_id,recipe_component_id) WHERE type='SALE_CONSUMPTION' AND source_type='ORDER_CONSUMPTION'`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_movements_reversal ON inventory_stock_movements(coffee_shop_id,reversal_of_movement_id) WHERE reversal_of_movement_id IS NOT NULL`);
    await q.query(`CREATE FUNCTION validate_inventory_sale_reversal() RETURNS trigger AS $$
      DECLARE original inventory_stock_movements%ROWTYPE;
      BEGIN
        IF NEW.type <> 'SALE_REVERSAL' THEN RETURN NEW; END IF;
        SELECT * INTO original FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.reversal_of_movement_id FOR KEY SHARE;
        IF NOT FOUND OR original.type <> 'SALE_CONSUMPTION' OR original.quantity_base >= 0
          OR NEW.quantity_base <> -original.quantity_base OR NEW.item_id <> original.item_id OR NEW.location_id <> original.location_id
          OR NEW.source_id IS DISTINCT FROM original.source_id OR NEW.order_item_id IS DISTINCT FROM original.order_item_id
          OR NEW.recipe_version_id IS DISTINCT FROM original.recipe_version_id OR NEW.recipe_component_id IS DISTINCT FROM original.recipe_component_id THEN
          RAISE EXCEPTION 'sale reversal must exactly restore its original consumption movement';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_sale_reversal_valid BEFORE INSERT ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION validate_inventory_sale_reversal()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DO $$ BEGIN IF EXISTS (SELECT 1 FROM inventory_stock_movements WHERE source_type IN ('ORDER_CONSUMPTION','ORDER_REVERSAL') OR reversal_of_movement_id IS NOT NULL) THEN RAISE EXCEPTION 'cannot revert order inventory schema while order movements exist'; END IF; END $$`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_sale_reversal_valid ON inventory_stock_movements`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_sale_reversal()`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_movements_reversal`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_movements_order_consumption`);
    await q.query(`ALTER TABLE inventory_stock_movements DROP CONSTRAINT IF EXISTS CK_inventory_movement_order_consumption, DROP CONSTRAINT IF EXISTS CK_inventory_movement_reversal_ref, DROP CONSTRAINT IF EXISTS FK_inventory_movement_reversal_tenant, DROP CONSTRAINT IF EXISTS FK_inventory_movement_recipe_component_tenant, DROP CONSTRAINT IF EXISTS FK_inventory_movement_recipe_version_tenant, DROP CONSTRAINT IF EXISTS FK_inventory_movement_order_item_tenant, DROP CONSTRAINT IF EXISTS UQ_inventory_movements_tenant_id, DROP COLUMN IF EXISTS reversal_of_movement_id, DROP COLUMN IF EXISTS recipe_component_id, DROP COLUMN IF EXISTS recipe_version_id, DROP COLUMN IF EXISTS order_item_id`);
    await q.query(`ALTER TABLE order_items DROP CONSTRAINT IF EXISTS UQ_order_items_tenant_id`);
  }
}
