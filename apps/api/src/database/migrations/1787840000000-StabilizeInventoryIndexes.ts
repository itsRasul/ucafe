import { MigrationInterface, QueryRunner } from "typeorm";

export class StabilizeInventoryIndexes1787840000000 implements MigrationInterface {
  name = "StabilizeInventoryIndexes1787840000000";

  async up(q: QueryRunner) {
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_categories_name_normalized ON inventory_categories(coffee_shop_id, lower(btrim(name)))`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_locations_name_normalized ON inventory_locations(coffee_shop_id, lower(btrim(name)))`);
    await q.query(`CREATE INDEX IDX_inventory_movements_tenant_created ON inventory_stock_movements(coffee_shop_id, created_at DESC, id DESC)`);
    await q.query(`CREATE INDEX IDX_inventory_movements_balance_created ON inventory_stock_movements(coffee_shop_id, item_id, location_id, created_at DESC)`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP INDEX IDX_inventory_movements_balance_created`);
    await q.query(`DROP INDEX IDX_inventory_movements_tenant_created`);
    await q.query(`DROP INDEX UQ_inventory_locations_name_normalized`);
    await q.query(`DROP INDEX UQ_inventory_categories_name_normalized`);
  }
}
