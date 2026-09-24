import { MigrationInterface, QueryRunner } from "typeorm";

export class InventoryVarianceMovementIndex1787872800000 implements MigrationInterface {
  name = "InventoryVarianceMovementIndex1787872800000";

  async up(q: QueryRunner) {
    await q.query(`CREATE INDEX IDX_inventory_variance_movements_period
      ON inventory_stock_movements(coffee_shop_id,location_id,item_id,created_at)`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_variance_movements_period`);
  }
}
