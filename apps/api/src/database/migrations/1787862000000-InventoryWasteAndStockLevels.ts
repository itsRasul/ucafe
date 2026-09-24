import { MigrationInterface, QueryRunner } from "typeorm";

export class InventoryWasteAndStockLevels1787862000000 implements MigrationInterface {
  name = "InventoryWasteAndStockLevels1787862000000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_purchase_order_items ADD COLUMN location_id uuid`);
    await q.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default)
      SELECT DISTINCT i.coffee_shop_id,'Main Inventory',true FROM inventory_purchase_order_items i
      WHERE NOT EXISTS(SELECT 1 FROM inventory_locations l WHERE l.coffee_shop_id=i.coffee_shop_id AND l.is_default)
      ON CONFLICT(coffee_shop_id) WHERE is_default DO NOTHING`);
    await q.query(`UPDATE inventory_purchase_order_items i SET location_id=l.id FROM inventory_locations l
      WHERE l.coffee_shop_id=i.coffee_shop_id AND l.is_default AND i.location_id IS NULL`);
    await q.query(`ALTER TABLE inventory_purchase_order_items ALTER COLUMN location_id SET NOT NULL,
      ADD CONSTRAINT FK_inventory_purchase_order_item_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT`);
    await q.query(`CREATE INDEX IDX_inventory_purchase_order_items_location ON inventory_purchase_order_items(coffee_shop_id,location_id,inventory_item_id)`);

    await q.query(`CREATE TYPE inventory_waste_reason AS ENUM ('EXPIRED','DAMAGED','SPILLED','PREPARATION_ERROR','CUSTOMER_RETURN','QUALITY_ISSUE','OVERPRODUCTION','STAFF_USE','TRAINING','OTHER')`);
    await q.query(`CREATE TYPE inventory_waste_status AS ENUM ('DRAFT','POSTED','REVERSED')`);
    await q.query(`CREATE TYPE inventory_stock_alert_type AS ENUM ('NEGATIVE','OUT_OF_STOCK','LOW_STOCK')`);
    await q.query(`CREATE TYPE inventory_stock_alert_status AS ENUM ('OPEN','RESOLVED')`);

    await q.query(`CREATE TABLE inventory_stock_rules (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      item_id uuid NOT NULL, location_id uuid NOT NULL, minimum_quantity_base numeric(20,6), par_quantity_base numeric(20,6), display_unit varchar(16) NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_stock_rules_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_stock_rules_item_location UNIQUE(coffee_shop_id,item_id,location_id),
      CONSTRAINT FK_inventory_stock_rule_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_stock_rule_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_stock_rule_values CHECK((minimum_quantity_base IS NULL OR minimum_quantity_base>=0) AND (par_quantity_base IS NULL OR par_quantity_base>=0) AND (minimum_quantity_base IS NULL OR par_quantity_base IS NULL OR par_quantity_base>=minimum_quantity_base))
    )`);
    await q.query(`CREATE FUNCTION validate_inventory_stock_rule_unit() RETURNS trigger AS $$
      DECLARE item_dimension inventory_dimension; base_unit varchar(16);
      BEGIN
        SELECT dimension,inventory_items.base_unit INTO item_dimension,base_unit FROM inventory_items
          WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.item_id;
        IF item_dimension IS NULL OR NOT ((item_dimension='WEIGHT' AND NEW.display_unit IN ('g','kg')) OR
          (item_dimension='VOLUME' AND NEW.display_unit IN ('ml','l')) OR
          (item_dimension='COUNT' AND NEW.display_unit=base_unit)) THEN
          RAISE EXCEPTION 'stock rule unit does not match inventory item';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_stock_rule_unit BEFORE INSERT OR UPDATE OF coffee_shop_id,item_id,display_unit ON inventory_stock_rules FOR EACH ROW EXECUTE FUNCTION validate_inventory_stock_rule_unit()`);

    await q.query(`CREATE TABLE inventory_stock_alerts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      item_id uuid NOT NULL, location_id uuid NOT NULL, alert_type inventory_stock_alert_type NOT NULL,
      status inventory_stock_alert_status NOT NULL DEFAULT 'OPEN', opened_at timestamptz NOT NULL DEFAULT now(),
      last_observed_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
      CONSTRAINT UQ_inventory_stock_alerts_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT FK_inventory_stock_alert_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_stock_alert_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_stock_alert_resolution CHECK((status='OPEN' AND resolved_at IS NULL) OR (status='RESOLVED' AND resolved_at IS NOT NULL))
    )`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_stock_alert_open ON inventory_stock_alerts(coffee_shop_id,item_id,location_id) WHERE status='OPEN'`);
    await q.query(`CREATE INDEX IDX_inventory_stock_alerts_tenant_status ON inventory_stock_alerts(coffee_shop_id,status,opened_at DESC)`);

    await q.query(`CREATE TABLE inventory_waste_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      location_id uuid NOT NULL, wasted_at timestamptz NOT NULL DEFAULT now(), reason inventory_waste_reason NOT NULL,
      note varchar(1000), status inventory_waste_status NOT NULL DEFAULT 'DRAFT',
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      posted_by_user_id uuid REFERENCES users(id), posted_at timestamptz,
      reversed_by_user_id uuid REFERENCES users(id), reversed_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_waste_records_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT FK_inventory_waste_record_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_waste_record_note CHECK(note IS NULL OR length(btrim(note))>0),
      CONSTRAINT CK_inventory_waste_record_audit CHECK(
        (status='DRAFT' AND posted_by_user_id IS NULL AND posted_at IS NULL AND reversed_by_user_id IS NULL AND reversed_at IS NULL) OR
        (status='POSTED' AND posted_by_user_id IS NOT NULL AND posted_at IS NOT NULL AND reversed_by_user_id IS NULL AND reversed_at IS NULL) OR
        (status='REVERSED' AND posted_by_user_id IS NOT NULL AND posted_at IS NOT NULL AND reversed_by_user_id IS NOT NULL AND reversed_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX IDX_inventory_waste_records_tenant_date ON inventory_waste_records(coffee_shop_id,wasted_at DESC)`);
    await q.query(`CREATE INDEX IDX_inventory_waste_records_tenant_status_date ON inventory_waste_records(coffee_shop_id,status,wasted_at DESC)`);
    await q.query(`CREATE TABLE inventory_waste_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      waste_record_id uuid NOT NULL, item_id uuid NOT NULL, item_name_snapshot varchar(140) NOT NULL,
      quantity_display numeric(20,6) NOT NULL, unit varchar(16) NOT NULL, quantity_base numeric(20,6) NOT NULL, movement_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_waste_items_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_waste_items_item UNIQUE(coffee_shop_id,waste_record_id,item_id),
      CONSTRAINT FK_inventory_waste_item_record_tenant FOREIGN KEY(coffee_shop_id,waste_record_id) REFERENCES inventory_waste_records(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT FK_inventory_waste_item_item_tenant FOREIGN KEY(coffee_shop_id,item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_waste_item_movement_tenant FOREIGN KEY(coffee_shop_id,movement_id) REFERENCES inventory_stock_movements(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_waste_item_values CHECK(quantity_display>0 AND quantity_base>0),
      CONSTRAINT CK_inventory_waste_item_snapshot CHECK(length(btrim(item_name_snapshot))>0)
    )`);
    await q.query(`CREATE INDEX IDX_inventory_waste_items_item ON inventory_waste_items(coffee_shop_id,item_id)`);
    await q.query(`ALTER TABLE inventory_stock_movements
      ADD CONSTRAINT CK_inventory_waste_movement_source CHECK(type<>'WASTE' OR (quantity_base<0 AND source_type='WASTE_RECORD' AND source_id IS NOT NULL AND source_line_id IS NOT NULL)),
      ADD CONSTRAINT CK_inventory_waste_correction_source CHECK(source_type<>'WASTE_REVERSAL' OR (type='MANUAL_ADJUSTMENT' AND quantity_base>0 AND source_id IS NOT NULL AND source_line_id IS NOT NULL))`);

    await q.query(`CREATE FUNCTION protect_inventory_waste_record() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN
          IF OLD.status<>'DRAFT' THEN RAISE EXCEPTION 'posted waste records are immutable'; END IF;
          RETURN OLD;
        END IF;
        IF OLD.status='DRAFT' AND NEW.status IN ('DRAFT','POSTED') THEN
          IF NEW.status='POSTED' AND (NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.wasted_at IS DISTINCT FROM OLD.wasted_at OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.note IS DISTINCT FROM OLD.note OR
            NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.posted_at IS NULL OR NEW.posted_by_user_id IS NULL OR
            NOT EXISTS(SELECT 1 FROM inventory_waste_items i WHERE i.coffee_shop_id=NEW.coffee_shop_id AND i.waste_record_id=NEW.id) OR
            EXISTS(SELECT 1 FROM inventory_waste_items i WHERE i.coffee_shop_id=NEW.coffee_shop_id AND i.waste_record_id=NEW.id AND i.movement_id IS NULL)) THEN
            RAISE EXCEPTION 'waste must have posted movements before posting';
          END IF;
          RETURN NEW;
        END IF;
        IF OLD.status='POSTED' AND NEW.status='REVERSED' THEN
          IF NEW.location_id IS DISTINCT FROM OLD.location_id OR NEW.wasted_at IS DISTINCT FROM OLD.wasted_at OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.note IS DISTINCT FROM OLD.note OR
             NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id OR NEW.posted_by_user_id IS DISTINCT FROM OLD.posted_by_user_id OR NEW.posted_at IS DISTINCT FROM OLD.posted_at OR
             NEW.reversed_by_user_id IS NULL OR NEW.reversed_at IS NULL OR
             NOT EXISTS(SELECT 1 FROM inventory_waste_items i WHERE i.coffee_shop_id=NEW.coffee_shop_id AND i.waste_record_id=NEW.id) OR
             EXISTS(SELECT 1 FROM inventory_waste_items i WHERE i.coffee_shop_id=NEW.coffee_shop_id AND i.waste_record_id=NEW.id AND i.movement_id IS NULL) OR EXISTS(
               SELECT 1 FROM inventory_waste_items i JOIN inventory_stock_movements w ON w.coffee_shop_id=i.coffee_shop_id AND w.id=i.movement_id
               LEFT JOIN inventory_stock_movements r ON r.coffee_shop_id=i.coffee_shop_id AND r.source_type='WASTE_REVERSAL' AND r.source_id=NEW.id::text AND r.source_line_id=i.id::text
               WHERE i.coffee_shop_id=NEW.coffee_shop_id AND i.waste_record_id=NEW.id AND
                 (r.id IS NULL OR r.type<>'MANUAL_ADJUSTMENT' OR r.quantity_base<>-w.quantity_base OR r.item_id<>w.item_id OR r.location_id<>w.location_id)) THEN
            RAISE EXCEPTION 'waste correction must preserve history and restore every posted line';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid waste record status transition';
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_waste_record_protection BEFORE UPDATE OR DELETE ON inventory_waste_records FOR EACH ROW EXECUTE FUNCTION protect_inventory_waste_record()`);
    await q.query(`CREATE FUNCTION protect_inventory_waste_item() RETURNS trigger AS $$
      DECLARE record_status inventory_waste_status;
      BEGIN
        SELECT status INTO record_status FROM inventory_waste_records WHERE coffee_shop_id=COALESCE(NEW.coffee_shop_id,OLD.coffee_shop_id) AND id=COALESCE(NEW.waste_record_id,OLD.waste_record_id);
        IF record_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'posted waste lines are immutable'; END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_waste_item_protection BEFORE INSERT OR UPDATE OR DELETE ON inventory_waste_items FOR EACH ROW EXECUTE FUNCTION protect_inventory_waste_item()`);
    await q.query(`CREATE FUNCTION validate_inventory_waste_movement_link() RETURNS trigger AS $$
      DECLARE waste_location uuid; movement inventory_stock_movements%ROWTYPE;
      BEGIN
        IF NEW.movement_id IS NULL THEN RETURN NEW; END IF;
        SELECT location_id INTO waste_location FROM inventory_waste_records WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.waste_record_id;
        SELECT * INTO movement FROM inventory_stock_movements WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.movement_id;
        IF NOT FOUND OR movement.type<>'WASTE' OR movement.source_type<>'WASTE_RECORD' OR movement.source_id<>NEW.waste_record_id::text OR movement.source_line_id<>NEW.id::text OR
           movement.item_id<>NEW.item_id OR movement.location_id<>waste_location OR movement.quantity_base<>-NEW.quantity_base THEN
          RAISE EXCEPTION 'waste line must reference its matching waste movement';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_waste_movement_link BEFORE UPDATE OF movement_id ON inventory_waste_items FOR EACH ROW EXECUTE FUNCTION validate_inventory_waste_movement_link()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_waste_movement_link ON inventory_waste_items`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_waste_movement_link()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_waste_item_protection ON inventory_waste_items`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_waste_item()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_waste_record_protection ON inventory_waste_records`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_waste_record()`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_stock_rule_unit ON inventory_stock_rules`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_stock_rule_unit()`);
    await q.query(`DROP TABLE IF EXISTS inventory_waste_items,inventory_waste_records,inventory_stock_alerts,inventory_stock_rules CASCADE`);
    await q.query(`DROP TYPE IF EXISTS inventory_stock_alert_status,inventory_stock_alert_type,inventory_waste_status,inventory_waste_reason`);
    await q.query(`ALTER TABLE inventory_stock_movements DROP CONSTRAINT IF EXISTS CK_inventory_waste_correction_source,DROP CONSTRAINT IF EXISTS CK_inventory_waste_movement_source`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_purchase_order_items_location`);
    await q.query(`ALTER TABLE inventory_purchase_order_items DROP CONSTRAINT IF EXISTS FK_inventory_purchase_order_item_location_tenant,DROP COLUMN IF EXISTS location_id`);
  }
}
