import { MigrationInterface, QueryRunner } from "typeorm";

export class InventoryBatchesAndExpiry1787876400000 implements MigrationInterface {
  name = "InventoryBatchesAndExpiry1787876400000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_items
      ADD COLUMN batch_tracking_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN expiry_tracking_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN expiry_warning_days smallint NOT NULL DEFAULT 3,
      ADD CONSTRAINT CK_inventory_item_expiry_tracking CHECK (NOT expiry_tracking_enabled OR batch_tracking_enabled),
      ADD CONSTRAINT CK_inventory_item_expiry_warning_days CHECK (expiry_warning_days BETWEEN 0 AND 365)`);

    await q.query(`CREATE TABLE inventory_batches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      item_id uuid NOT NULL, location_id uuid NOT NULL, supplier_lot_number varchar(100), manufactured_date date, expiry_date date,
      received_at timestamptz NOT NULL DEFAULT now(), original_quantity_base numeric(20,6) NOT NULL,
      remaining_quantity_base numeric(20,6) NOT NULL DEFAULT 0, unit_cost_toman numeric(20,6), total_cost_toman bigint,
      origin_type varchar(24) NOT NULL, goods_receipt_id uuid, goods_receipt_line_id uuid,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_batches_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_batches_tenant_item UNIQUE(coffee_shop_id,id,item_id),
      CONSTRAINT UQ_inventory_batches_tenant_item_location UNIQUE(coffee_shop_id,id,item_id,location_id),
      CONSTRAINT FK_inventory_batch_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_batch_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_batch_receipt_tenant FOREIGN KEY(coffee_shop_id,goods_receipt_id) REFERENCES inventory_goods_receipts(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_batch_origin CHECK (origin_type IN ('GOODS_RECEIPT','OPENING_BALANCE','MANUAL')),
      CONSTRAINT CK_inventory_batch_receipt_source CHECK ((origin_type='GOODS_RECEIPT' AND goods_receipt_id IS NOT NULL AND goods_receipt_line_id IS NOT NULL) OR (origin_type<>'GOODS_RECEIPT' AND goods_receipt_id IS NULL AND goods_receipt_line_id IS NULL)),
      CONSTRAINT CK_inventory_batch_quantities CHECK (original_quantity_base>0 AND remaining_quantity_base>=0 AND original_quantity_base::text NOT IN ('NaN','Infinity','-Infinity') AND remaining_quantity_base::text NOT IN ('NaN','Infinity','-Infinity')),
      CONSTRAINT CK_inventory_batch_cost CHECK ((unit_cost_toman IS NULL)=(total_cost_toman IS NULL) AND (unit_cost_toman IS NULL OR (unit_cost_toman>=0 AND total_cost_toman>=0))),
      CONSTRAINT CK_inventory_batch_dates CHECK (manufactured_date IS NULL OR expiry_date IS NULL OR expiry_date>=manufactured_date)
    )`);
    await q.query(`CREATE INDEX IDX_inventory_batches_allocation ON inventory_batches(coffee_shop_id,item_id,location_id,expiry_date,received_at,id) WHERE remaining_quantity_base>0`);
    await q.query(`CREATE INDEX IDX_inventory_batches_receipt ON inventory_batches(coffee_shop_id,goods_receipt_id,goods_receipt_line_id) WHERE goods_receipt_id IS NOT NULL`);
    await q.query(`ALTER TABLE inventory_batches ADD CONSTRAINT FK_inventory_batch_receipt_line_tenant FOREIGN KEY(coffee_shop_id,goods_receipt_line_id) REFERENCES inventory_goods_receipt_lines(coffee_shop_id,id) ON DELETE RESTRICT`);

    await q.query(`ALTER TABLE inventory_stock_movements ADD COLUMN batch_id uuid,
      ADD CONSTRAINT FK_inventory_movement_batch_tenant FOREIGN KEY(coffee_shop_id,batch_id,item_id,location_id) REFERENCES inventory_batches(coffee_shop_id,id,item_id,location_id) ON DELETE RESTRICT`);
    await q.query(`ALTER TABLE inventory_stock_movements ALTER COLUMN idempotency_key TYPE varchar(200)`);
    await q.query(`DROP INDEX UQ_inventory_movements_order_consumption`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_movements_order_consumption ON inventory_stock_movements(coffee_shop_id,source_id,order_item_id,recipe_component_id,batch_id) NULLS NOT DISTINCT WHERE type='SALE_CONSUMPTION' AND source_type='ORDER_CONSUMPTION'`);
    await q.query(`CREATE INDEX IDX_inventory_movements_batch ON inventory_stock_movements(coffee_shop_id,batch_id,created_at,id) WHERE batch_id IS NOT NULL`);

    await q.query(`CREATE FUNCTION apply_inventory_batch_movement() RETURNS trigger AS $$
      BEGIN
        IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;
        UPDATE inventory_batches SET remaining_quantity_base=remaining_quantity_base+NEW.quantity_base,updated_at=clock_timestamp()
          WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.batch_id AND item_id=NEW.item_id AND location_id=NEW.location_id
            AND remaining_quantity_base+NEW.quantity_base>=0;
        IF NOT FOUND THEN RAISE EXCEPTION 'batch movement does not match stock or would make batch quantity negative'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_batch_movement BEFORE INSERT ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION apply_inventory_batch_movement()`);

    await q.query(`CREATE FUNCTION protect_inventory_batch_provenance() RETURNS trigger AS $$
      BEGIN
        IF NEW.coffee_shop_id IS DISTINCT FROM OLD.coffee_shop_id OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.location_id IS DISTINCT FROM OLD.location_id OR
          NEW.received_at IS DISTINCT FROM OLD.received_at OR NEW.original_quantity_base IS DISTINCT FROM OLD.original_quantity_base OR
          NEW.unit_cost_toman IS DISTINCT FROM OLD.unit_cost_toman OR NEW.total_cost_toman IS DISTINCT FROM OLD.total_cost_toman OR
          NEW.origin_type IS DISTINCT FROM OLD.origin_type OR NEW.goods_receipt_id IS DISTINCT FROM OLD.goods_receipt_id OR
          NEW.goods_receipt_line_id IS DISTINCT FROM OLD.goods_receipt_line_id THEN
          RAISE EXCEPTION 'batch provenance is immutable';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_batch_provenance BEFORE UPDATE ON inventory_batches FOR EACH ROW EXECUTE FUNCTION protect_inventory_batch_provenance()`);
    await q.query(`CREATE FUNCTION validate_inventory_batch_receipt_source() RETURNS trigger AS $$
      DECLARE line inventory_goods_receipt_lines%ROWTYPE;
      BEGIN
        IF NEW.origin_type<>'GOODS_RECEIPT' THEN RETURN NEW; END IF;
        SELECT * INTO line FROM inventory_goods_receipt_lines WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.goods_receipt_line_id;
        IF NOT FOUND OR line.goods_receipt_id<>NEW.goods_receipt_id OR line.inventory_item_id<>NEW.item_id OR line.location_id<>NEW.location_id THEN
          RAISE EXCEPTION 'batch receipt provenance is invalid';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_batch_receipt_source BEFORE INSERT ON inventory_batches FOR EACH ROW EXECUTE FUNCTION validate_inventory_batch_receipt_source()`);
    await q.query(`CREATE FUNCTION prevent_disabling_batch_tracking() RETURNS trigger AS $$
      BEGIN
        IF OLD.batch_tracking_enabled AND NOT NEW.batch_tracking_enabled AND EXISTS (
          SELECT 1 FROM inventory_batches b WHERE b.coffee_shop_id=OLD.coffee_shop_id AND b.item_id=OLD.id AND b.remaining_quantity_base>0
          UNION ALL
          SELECT 1 FROM inventory_stock_balances s WHERE s.coffee_shop_id=OLD.coffee_shop_id AND s.item_id=OLD.id AND s.quantity_base>0
        ) THEN RAISE EXCEPTION 'batch tracking cannot be disabled while batch stock remains'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_item_batch_tracking BEFORE UPDATE OF batch_tracking_enabled ON inventory_items FOR EACH ROW EXECUTE FUNCTION prevent_disabling_batch_tracking()`);

    await q.query(`ALTER TABLE inventory_goods_receipt_lines ADD COLUMN batch_details jsonb NOT NULL DEFAULT '[]'::jsonb,
      ADD CONSTRAINT CK_inventory_receipt_line_batch_details CHECK (jsonb_typeof(batch_details)='array')`);

    await q.query(`ALTER TABLE inventory_stock_count_lines DROP CONSTRAINT UQ_inventory_stock_count_line_item, ADD COLUMN batch_id uuid, ADD COLUMN allocation_type varchar(16) NOT NULL DEFAULT 'AGGREGATE',
      ADD CONSTRAINT CK_inventory_count_line_allocation CHECK ((allocation_type='BATCH' AND batch_id IS NOT NULL) OR (allocation_type IN ('AGGREGATE','UNALLOCATED') AND batch_id IS NULL)),
      ADD CONSTRAINT FK_inventory_count_line_batch_tenant FOREIGN KEY(coffee_shop_id,batch_id,item_id) REFERENCES inventory_batches(coffee_shop_id,id,item_id) ON DELETE RESTRICT`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_stock_count_line_item ON inventory_stock_count_lines(coffee_shop_id,count_id,item_id,allocation_type,COALESCE(batch_id,'00000000-0000-0000-0000-000000000000'::uuid))`);

    await q.query(`ALTER TABLE inventory_waste_items DROP CONSTRAINT UQ_inventory_waste_items_item, ADD COLUMN batch_id uuid,
      ADD CONSTRAINT FK_inventory_waste_item_batch_tenant FOREIGN KEY(coffee_shop_id,batch_id,item_id) REFERENCES inventory_batches(coffee_shop_id,id,item_id) ON DELETE RESTRICT`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_waste_items_item ON inventory_waste_items(coffee_shop_id,waste_record_id,item_id,COALESCE(batch_id,'00000000-0000-0000-0000-000000000000'::uuid))`);

    await q.query(`ALTER TABLE inventory_stock_alerts ADD COLUMN batch_id uuid,
      ADD CONSTRAINT FK_inventory_stock_alert_batch_tenant FOREIGN KEY(coffee_shop_id,batch_id,item_id,location_id) REFERENCES inventory_batches(coffee_shop_id,id,item_id,location_id) ON DELETE RESTRICT`);
    await q.query(`DROP INDEX UQ_inventory_stock_alert_open`);
    await q.query(`ALTER TABLE inventory_stock_alerts ALTER COLUMN alert_type TYPE varchar(32) USING alert_type::text`);
    await q.query(`DROP TYPE inventory_stock_alert_type`);
    await q.query(`ALTER TABLE inventory_stock_alerts ADD CONSTRAINT CK_inventory_stock_alert_type CHECK (alert_type IN ('NEGATIVE','OUT_OF_STOCK','LOW_STOCK','BATCH_EXPIRING_SOON','BATCH_EXPIRED'))`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_stock_alert_open ON inventory_stock_alerts(coffee_shop_id,item_id,location_id) WHERE status='OPEN' AND batch_id IS NULL`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_stock_alert_open_batch ON inventory_stock_alerts(coffee_shop_id,batch_id) WHERE status='OPEN' AND batch_id IS NOT NULL`);

    await q.query(`CREATE TABLE inventory_batch_changes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      batch_id uuid NOT NULL, actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL, reason varchar(240) NOT NULL,
      old_supplier_lot_number varchar(100), new_supplier_lot_number varchar(100), old_manufactured_date date, new_manufactured_date date,
      old_expiry_date date, new_expiry_date date, created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT FK_inventory_batch_change_batch_tenant FOREIGN KEY(coffee_shop_id,batch_id) REFERENCES inventory_batches(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_batch_change_reason CHECK(length(btrim(reason))>0)
    )`);
    await q.query(`CREATE INDEX IDX_inventory_batch_changes_history ON inventory_batch_changes(coffee_shop_id,batch_id,created_at DESC)`);

    await q.query(`CREATE FUNCTION validate_inventory_batch_count_line() RETURNS trigger AS $$
      DECLARE count_location uuid;
      BEGIN
        IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;
        SELECT location_id INTO count_location FROM inventory_stock_counts WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.count_id;
        IF NOT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.coffee_shop_id=NEW.coffee_shop_id AND b.id=NEW.batch_id AND b.item_id=NEW.item_id AND b.location_id=count_location) THEN
          RAISE EXCEPTION 'count batch must match count item and location';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_batch_count_line BEFORE INSERT OR UPDATE OF batch_id,item_id,count_id ON inventory_stock_count_lines FOR EACH ROW EXECUTE FUNCTION validate_inventory_batch_count_line()`);
    await q.query(`CREATE FUNCTION validate_inventory_batch_waste_line() RETURNS trigger AS $$
      DECLARE waste_location uuid;
      BEGIN
        IF NEW.batch_id IS NULL THEN RETURN NEW; END IF;
        SELECT location_id INTO waste_location FROM inventory_waste_records WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.waste_record_id;
        IF NOT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.coffee_shop_id=NEW.coffee_shop_id AND b.id=NEW.batch_id AND b.item_id=NEW.item_id AND b.location_id=waste_location) THEN
          RAISE EXCEPTION 'waste batch must match item and location';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_batch_waste_line BEFORE INSERT OR UPDATE OF batch_id,item_id,waste_record_id ON inventory_waste_items FOR EACH ROW EXECUTE FUNCTION validate_inventory_batch_waste_line()`);

    await q.query(`CREATE OR REPLACE FUNCTION validate_inventory_sale_reversal() RETURNS trigger AS $$
      DECLARE original inventory_stock_movements%ROWTYPE;
      BEGIN
        IF NEW.type <> 'SALE_REVERSAL' THEN RETURN NEW; END IF;
        SELECT * INTO original FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.reversal_of_movement_id FOR KEY SHARE;
        IF NOT FOUND OR original.type <> 'SALE_CONSUMPTION' OR original.quantity_base >= 0 OR
          NEW.quantity_base <> -original.quantity_base OR NEW.item_id <> original.item_id OR NEW.location_id <> original.location_id OR NEW.batch_id IS DISTINCT FROM original.batch_id OR
          NEW.source_id IS DISTINCT FROM original.source_id OR NEW.order_item_id IS DISTINCT FROM original.order_item_id OR
          NEW.recipe_version_id IS DISTINCT FROM original.recipe_version_id OR NEW.recipe_component_id IS DISTINCT FROM original.recipe_component_id OR
          NEW.unit_cost_toman IS DISTINCT FROM original.unit_cost_toman OR NEW.total_cost_toman IS DISTINCT FROM original.total_cost_toman THEN
          RAISE EXCEPTION 'sale reversal must exactly restore its original consumption movement and cost snapshot';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);

    await q.query(`CREATE OR REPLACE FUNCTION validate_inventory_waste_movement_link() RETURNS trigger AS $$
      DECLARE waste_location uuid; movement inventory_stock_movements%ROWTYPE;
      BEGIN
        IF NEW.movement_id IS NULL THEN RETURN NEW; END IF;
        SELECT location_id INTO waste_location FROM inventory_waste_records WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.waste_record_id;
        SELECT * INTO movement FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.movement_id;
        IF NOT FOUND OR movement.type<>'WASTE' OR movement.source_type<>'WASTE_RECORD' OR movement.source_id<>NEW.waste_record_id::text OR movement.source_line_id<>NEW.id::text OR
          movement.item_id<>NEW.item_id OR movement.location_id<>waste_location OR movement.quantity_base<>-NEW.quantity_base OR movement.batch_id IS DISTINCT FROM NEW.batch_id THEN
          RAISE EXCEPTION 'waste line must reference its matching waste movement';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE FUNCTION validate_inventory_waste_reversal_batch() RETURNS trigger AS $$
      DECLARE original inventory_stock_movements%ROWTYPE; waste_line inventory_waste_items%ROWTYPE;
      BEGIN
        IF NEW.source_type<>'WASTE_REVERSAL' THEN RETURN NEW; END IF;
        SELECT * INTO waste_line FROM inventory_waste_items WHERE coffee_shop_id=NEW.coffee_shop_id AND id::text=NEW.source_line_id AND waste_record_id::text=NEW.source_id;
        SELECT * INTO original FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=waste_line.movement_id;
        IF NOT FOUND OR original.type<>'WASTE' OR NEW.batch_id IS DISTINCT FROM original.batch_id OR NEW.item_id<>original.item_id OR NEW.location_id<>original.location_id OR NEW.quantity_base<>-original.quantity_base THEN
          RAISE EXCEPTION 'waste reversal must restore the original batch movement';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_waste_reversal_batch BEFORE INSERT ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION validate_inventory_waste_reversal_batch()`);
    await q.query(`ALTER TABLE inventory_stock_movements ADD CONSTRAINT CK_inventory_batch_movement_source CHECK(batch_id IS NULL OR type IN ('PURCHASE_RECEIPT','OPENING_BALANCE','SALE_CONSUMPTION','SALE_REVERSAL','WASTE','MANUAL_ADJUSTMENT','STOCK_COUNT_ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','PRODUCTION_OUTPUT','PRODUCTION_CONSUMPTION'))`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_waste_reversal_batch ON inventory_stock_movements`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_waste_reversal_batch()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_batch_waste_line ON inventory_waste_items`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_batch_waste_line()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_batch_count_line ON inventory_stock_count_lines`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_batch_count_line()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_batch_receipt_source ON inventory_batches`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_batch_receipt_source()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_batch_movement ON inventory_stock_movements`);
    await q.query(`DROP FUNCTION IF EXISTS apply_inventory_batch_movement()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_batch_provenance ON inventory_batches`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_batch_provenance()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_item_batch_tracking ON inventory_items`);
    await q.query(`DROP FUNCTION IF EXISTS prevent_disabling_batch_tracking()`);
    await q.query(`ALTER TABLE inventory_stock_movements DROP CONSTRAINT IF EXISTS CK_inventory_batch_movement_source, DROP CONSTRAINT IF EXISTS FK_inventory_movement_batch_tenant, DROP COLUMN IF EXISTS batch_id`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_movements_batch`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_movements_order_consumption`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_movements_order_consumption ON inventory_stock_movements(coffee_shop_id,source_id,order_item_id,recipe_component_id) WHERE type='SALE_CONSUMPTION' AND source_type='ORDER_CONSUMPTION'`);
    await q.query(`ALTER TABLE inventory_stock_count_lines DROP CONSTRAINT IF EXISTS CK_inventory_count_line_allocation, DROP CONSTRAINT IF EXISTS FK_inventory_count_line_batch_tenant, DROP COLUMN IF EXISTS allocation_type, DROP COLUMN IF EXISTS batch_id`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_stock_count_line_item`);
    await q.query(`ALTER TABLE inventory_stock_count_lines ADD CONSTRAINT UQ_inventory_stock_count_line_item UNIQUE(coffee_shop_id,count_id,item_id)`);
    await q.query(`ALTER TABLE inventory_waste_items DROP CONSTRAINT IF EXISTS FK_inventory_waste_item_batch_tenant, DROP COLUMN IF EXISTS batch_id`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_waste_items_item`);
    await q.query(`ALTER TABLE inventory_waste_items ADD CONSTRAINT UQ_inventory_waste_items_item UNIQUE(coffee_shop_id,waste_record_id,item_id)`);
    await q.query(`ALTER TABLE inventory_stock_alerts DROP CONSTRAINT IF EXISTS CK_inventory_stock_alert_type, DROP CONSTRAINT IF EXISTS FK_inventory_stock_alert_batch_tenant, DROP COLUMN IF EXISTS batch_id`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_stock_alert_open, UQ_inventory_stock_alert_open_batch`);
    await q.query(`DELETE FROM inventory_stock_alerts WHERE alert_type LIKE 'BATCH_%'`);
    await q.query(`CREATE TYPE inventory_stock_alert_type AS ENUM ('NEGATIVE','OUT_OF_STOCK','LOW_STOCK')`);
    await q.query(`ALTER TABLE inventory_stock_alerts ALTER COLUMN alert_type TYPE inventory_stock_alert_type USING alert_type::inventory_stock_alert_type`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_stock_alert_open ON inventory_stock_alerts(coffee_shop_id,item_id,location_id) WHERE status='OPEN'`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_waste_movement_link ON inventory_waste_items`);
    await q.query(`DROP TABLE IF EXISTS inventory_batch_changes,inventory_batches CASCADE`);
    await q.query(`ALTER TABLE inventory_goods_receipt_lines DROP CONSTRAINT IF EXISTS CK_inventory_receipt_line_batch_details, DROP COLUMN IF EXISTS batch_details`);
    await q.query(`ALTER TABLE inventory_items DROP CONSTRAINT IF EXISTS CK_inventory_item_expiry_warning_days, DROP CONSTRAINT IF EXISTS CK_inventory_item_expiry_tracking, DROP COLUMN IF EXISTS expiry_warning_days, DROP COLUMN IF EXISTS expiry_tracking_enabled, DROP COLUMN IF EXISTS batch_tracking_enabled`);
  }
}
