import { MigrationInterface, QueryRunner } from "typeorm";

export class InventoryOperations1787835600000 implements MigrationInterface {
  name = "InventoryOperations1787835600000";

  async up(q: QueryRunner) {
    await q.query(`INSERT INTO permissions(scope,key,description) VALUES
      ('TENANT','inventory.read','View inventory and stock history'),
      ('TENANT','inventory.manage','Manage inventory items, locations and stock') ON CONFLICT(key) DO NOTHING`);
    await q.query(`INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE r.scope='TENANT' AND r.key='owner' AND p.key IN ('inventory.read','inventory.manage') ON CONFLICT DO NOTHING`);
    await q.query(`CREATE TYPE inventory_count_status AS ENUM ('DRAFT','COMPLETED')`);
    await q.query(`CREATE TABLE inventory_categories(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      name varchar(80) NOT NULL, is_active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_categories_tenant_id UNIQUE(coffee_shop_id,id), CONSTRAINT UQ_inventory_categories_name UNIQUE(coffee_shop_id,name))`);
    await q.query(`ALTER TABLE inventory_items ADD COLUMN category_id uuid`);
    await q.query(`ALTER TABLE inventory_items ADD CONSTRAINT FK_inventory_item_category_tenant FOREIGN KEY(coffee_shop_id,category_id) REFERENCES inventory_categories(coffee_shop_id,id) ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX IDX_inventory_items_tenant_name ON inventory_items(coffee_shop_id,name)`);
    await q.query(`CREATE INDEX IDX_inventory_balance_location ON inventory_stock_balances(coffee_shop_id,location_id,item_id)`);
    await q.query(`CREATE TABLE inventory_stock_counts(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      location_id uuid NOT NULL, status inventory_count_status NOT NULL DEFAULT 'DRAFT', note varchar(500),
      created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT, completed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      completed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_stock_counts_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT FK_inventory_count_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_count_completion CHECK ((status='DRAFT' AND completed_at IS NULL) OR (status='COMPLETED' AND completed_at IS NOT NULL)))`);
    await q.query(`CREATE INDEX IDX_inventory_counts_tenant_created ON inventory_stock_counts(coffee_shop_id,created_at DESC)`);
    await q.query(`CREATE TABLE inventory_stock_count_lines(
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL, count_id uuid NOT NULL, item_id uuid NOT NULL,
      expected_quantity numeric(20,6) NOT NULL, counted_quantity numeric(20,6) NOT NULL, counted_at timestamptz NOT NULL,
      variance_quantity numeric(20,6), movement_id uuid REFERENCES inventory_stock_movements(id) ON DELETE RESTRICT,
      CONSTRAINT UQ_inventory_stock_count_line_item UNIQUE(coffee_shop_id,count_id,item_id),
      CONSTRAINT FK_inventory_count_line_count_tenant FOREIGN KEY(coffee_shop_id,count_id) REFERENCES inventory_stock_counts(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_count_line_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT)`);
    await q.query(`CREATE FUNCTION reject_completed_inventory_count() RETURNS trigger AS $$ BEGIN IF OLD.status='COMPLETED' THEN RAISE EXCEPTION 'completed inventory counts are immutable'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_count_immutable BEFORE UPDATE OR DELETE ON inventory_stock_counts FOR EACH ROW EXECUTE FUNCTION reject_completed_inventory_count()`);
    await q.query(`CREATE FUNCTION reject_completed_inventory_count_line() RETURNS trigger AS $$ DECLARE count_status inventory_count_status; BEGIN SELECT status INTO count_status FROM inventory_stock_counts WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.count_id ELSE NEW.count_id END AND coffee_shop_id=CASE WHEN TG_OP='DELETE' THEN OLD.coffee_shop_id ELSE NEW.coffee_shop_id END; IF count_status='COMPLETED' THEN RAISE EXCEPTION 'completed inventory count lines are immutable'; END IF; IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF; END; $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_count_line_immutable BEFORE INSERT OR UPDATE OR DELETE ON inventory_stock_count_lines FOR EACH ROW EXECUTE FUNCTION reject_completed_inventory_count_line()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_count_line_immutable ON inventory_stock_count_lines`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_count_immutable ON inventory_stock_counts`);
    await q.query(`DROP FUNCTION IF EXISTS reject_completed_inventory_count_line()`);
    await q.query(`DROP FUNCTION IF EXISTS reject_completed_inventory_count()`);
    await q.query(`DROP TABLE IF EXISTS inventory_stock_count_lines, inventory_stock_counts`);
    await q.query(`ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS FK_inventory_item_category_tenant, DROP COLUMN IF EXISTS category_id`);
    await q.query(`DROP TABLE IF EXISTS inventory_categories`);
    await q.query(`DROP TYPE IF EXISTS inventory_count_status`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_balance_location`);
    // Preserve added role grants so a rollback does not erase platform-managed authorization.
  }
}
