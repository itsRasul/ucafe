import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateInventoryFoundation1787832000000 implements MigrationInterface {
  name = "CreateInventoryFoundation1787832000000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`UPDATE subscription_plans SET features=COALESCE(features,'{}'::jsonb)||'{"inventory":true}'::jsonb WHERE key='golden' AND NOT (COALESCE(features,'{}'::jsonb)?'inventory')`);
    await queryRunner.query(`CREATE TYPE inventory_dimension AS ENUM ('WEIGHT','VOLUME','COUNT')`);
    await queryRunner.query(`CREATE TYPE inventory_movement_type AS ENUM ('OPENING_BALANCE','PURCHASE_RECEIPT','SALE_CONSUMPTION','SALE_REVERSAL','WASTE','MANUAL_ADJUSTMENT','STOCK_COUNT_ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','PRODUCTION_CONSUMPTION','PRODUCTION_OUTPUT')`);
    await queryRunner.query(`CREATE TABLE inventory_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      name varchar(140) NOT NULL, sku varchar(80), description varchar(500), dimension inventory_dimension NOT NULL, base_unit varchar(16) NOT NULL,
      is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_items_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT CK_inventory_item_unit CHECK ((dimension='WEIGHT' AND base_unit IN ('g','kg')) OR (dimension='VOLUME' AND base_unit IN ('ml','l')) OR (dimension='COUNT' AND base_unit IN ('piece','pack','box','bottle')))
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_inventory_items_tenant_sku ON inventory_items(coffee_shop_id,sku) WHERE sku IS NOT NULL`);
    await queryRunner.query(`CREATE TABLE inventory_locations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      name varchar(120) NOT NULL, is_default boolean NOT NULL DEFAULT false, is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_locations_tenant_id UNIQUE(coffee_shop_id,id)
    )`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_inventory_locations_default ON inventory_locations(coffee_shop_id) WHERE is_default`);
    await queryRunner.query(`CREATE TABLE inventory_stock_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      item_id uuid NOT NULL, location_id uuid NOT NULL, type inventory_movement_type NOT NULL,
      quantity_base numeric(20,6) NOT NULL, unit_cost_toman numeric(20,6), source_type varchar(40), source_id varchar(100),
      idempotency_key varchar(100), actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, reason varchar(500),
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT FK_inventory_movement_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_movement_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_movement_quantity CHECK (quantity_base <> 0), CONSTRAINT CK_inventory_movement_cost CHECK (unit_cost_toman IS NULL OR unit_cost_toman >= 0)
    )`);
    await queryRunner.query(`CREATE INDEX IDX_inventory_movements_item_created ON inventory_stock_movements(coffee_shop_id,item_id,created_at DESC)`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_inventory_movements_idempotency ON inventory_stock_movements(coffee_shop_id,idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await queryRunner.query(`CREATE TABLE inventory_stock_balances (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      item_id uuid NOT NULL, location_id uuid NOT NULL, quantity_base numeric(20,6) NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT FK_inventory_balance_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_balance_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT UQ_inventory_stock_balances_item_location UNIQUE(coffee_shop_id,item_id,location_id)
    )`);
    await queryRunner.query(`CREATE FUNCTION reject_inventory_movement_mutation() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'inventory stock movements are immutable'; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER TRG_inventory_movements_immutable BEFORE UPDATE OR DELETE ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION reject_inventory_movement_mutation()`);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`DROP TRIGGER IF EXISTS TRG_inventory_movements_immutable ON inventory_stock_movements`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS reject_inventory_movement_mutation()`);
    await queryRunner.query(`DROP TABLE IF EXISTS inventory_stock_balances, inventory_stock_movements, inventory_locations, inventory_items`);
    await queryRunner.query(`DROP TYPE IF EXISTS inventory_movement_type, inventory_dimension`);
    // Keep the plan flag: platform operators may have changed it after migration.
  }
}
