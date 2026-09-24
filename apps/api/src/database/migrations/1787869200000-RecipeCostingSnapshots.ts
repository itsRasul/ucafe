import { MigrationInterface, QueryRunner } from "typeorm";

export class RecipeCostingSnapshots1787869200000 implements MigrationInterface {
  name = "RecipeCostingSnapshots1787869200000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_stock_balances
      ADD CONSTRAINT CK_inventory_balance_average_cost CHECK (
        average_unit_cost_toman IS NULL OR (average_unit_cost_toman >= 0 AND average_unit_cost_toman::text NOT IN ('NaN','Infinity','-Infinity'))
      )`);
    await q.query(`ALTER TABLE inventory_stock_movements
      ADD CONSTRAINT CK_inventory_movement_sale_cost_snapshot CHECK (
        type <> 'SALE_CONSUMPTION' OR
        ((unit_cost_toman IS NULL) = (total_cost_toman IS NULL) AND
         (unit_cost_toman IS NULL OR (unit_cost_toman >= 0 AND unit_cost_toman::text NOT IN ('NaN','Infinity','-Infinity') AND total_cost_toman >= 0)))
      )`);
    await q.query(`CREATE OR REPLACE FUNCTION validate_inventory_sale_reversal() RETURNS trigger AS $$
      DECLARE original inventory_stock_movements%ROWTYPE;
      BEGIN
        IF NEW.type <> 'SALE_REVERSAL' THEN RETURN NEW; END IF;
        SELECT * INTO original FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.reversal_of_movement_id FOR KEY SHARE;
        IF NOT FOUND OR original.type <> 'SALE_CONSUMPTION' OR original.quantity_base >= 0
          OR NEW.quantity_base <> -original.quantity_base OR NEW.item_id <> original.item_id OR NEW.location_id <> original.location_id
          OR NEW.source_id IS DISTINCT FROM original.source_id OR NEW.order_item_id IS DISTINCT FROM original.order_item_id
          OR NEW.recipe_version_id IS DISTINCT FROM original.recipe_version_id OR NEW.recipe_component_id IS DISTINCT FROM original.recipe_component_id
          OR NEW.unit_cost_toman IS DISTINCT FROM original.unit_cost_toman OR NEW.total_cost_toman IS DISTINCT FROM original.total_cost_toman THEN
          RAISE EXCEPTION 'sale reversal must exactly restore its original consumption movement and cost snapshot';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
  }

  async down(q: QueryRunner) {
    await q.query(`CREATE OR REPLACE FUNCTION validate_inventory_sale_reversal() RETURNS trigger AS $$
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
    await q.query(`ALTER TABLE inventory_stock_movements DROP CONSTRAINT CK_inventory_movement_sale_cost_snapshot`);
    await q.query(`ALTER TABLE inventory_stock_balances DROP CONSTRAINT CK_inventory_balance_average_cost`);
  }
}
