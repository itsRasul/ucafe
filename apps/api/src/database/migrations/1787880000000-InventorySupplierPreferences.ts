import { MigrationInterface, QueryRunner } from "typeorm";

export class InventorySupplierPreferences1787880000000 implements MigrationInterface {
  name = "InventorySupplierPreferences1787880000000";

  async up(q: QueryRunner) {
    await q.query(`CREATE TABLE inventory_supplier_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL,
      inventory_item_id uuid NOT NULL,
      preferred_purchase_unit varchar(16),
      minimum_order_quantity_base numeric(20,6),
      is_preferred boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_supplier_items_pair UNIQUE(coffee_shop_id,supplier_id,inventory_item_id),
      CONSTRAINT FK_inventory_supplier_item_supplier FOREIGN KEY(coffee_shop_id,supplier_id) REFERENCES inventory_suppliers(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT FK_inventory_supplier_item_inventory_item FOREIGN KEY(coffee_shop_id,inventory_item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_supplier_item_moq CHECK(minimum_order_quantity_base IS NULL OR (minimum_order_quantity_base>0 AND minimum_order_quantity_base::text NOT IN ('NaN','Infinity','-Infinity')))
    )`);
    await q.query(`CREATE INDEX IDX_inventory_supplier_items_item ON inventory_supplier_items(coffee_shop_id,inventory_item_id,supplier_id)`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_supplier_items_preferred ON inventory_supplier_items(coffee_shop_id,inventory_item_id) WHERE is_preferred`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TABLE inventory_supplier_items`);
  }
}
