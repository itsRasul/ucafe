import { MigrationInterface, QueryRunner } from "typeorm";

export class InventoryPurchasing1787854800000 implements MigrationInterface {
  name = "InventoryPurchasing1787854800000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_stock_balances ADD COLUMN average_unit_cost_toman numeric(20,6)`);
    await q.query(`ALTER TABLE inventory_stock_movements ADD COLUMN source_line_id varchar(100), ADD COLUMN total_cost_toman bigint`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_movement_source_line ON inventory_stock_movements(coffee_shop_id,source_type,source_id,source_line_id) WHERE source_line_id IS NOT NULL`);
    await q.query(`CREATE INDEX IDX_inventory_movement_source ON inventory_stock_movements(coffee_shop_id,source_type,source_id)`);
    await q.query(`CREATE TYPE inventory_purchase_order_status AS ENUM ('DRAFT','ORDERED','PARTIALLY_RECEIVED','RECEIVED','CANCELED')`);
    await q.query(`CREATE TYPE inventory_goods_receipt_status AS ENUM ('DRAFT','POSTED')`);
    await q.query(`CREATE TABLE inventory_document_sequences (
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      document_type varchar(8) NOT NULL,
      value bigint NOT NULL DEFAULT 0,
      PRIMARY KEY(coffee_shop_id,document_type),
      CONSTRAINT CK_inventory_document_sequence_type CHECK(document_type IN ('PO','GR')),
      CONSTRAINT CK_inventory_document_sequence_value CHECK(value >= 0)
    )`);
    await q.query(`CREATE TABLE inventory_suppliers (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      name varchar(140) NOT NULL,
      contact_person varchar(140),
      phone varchar(40),
      email varchar(254),
      address varchar(500),
      notes varchar(1000),
      is_active boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_suppliers_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT CK_inventory_supplier_name CHECK(length(btrim(name)) > 0)
    )`);
    await q.query(`CREATE UNIQUE INDEX UQ_inventory_suppliers_tenant_name ON inventory_suppliers(coffee_shop_id,lower(name))`);
    await q.query(`CREATE INDEX IDX_inventory_suppliers_tenant_active ON inventory_suppliers(coffee_shop_id,is_active,name)`);
    await q.query(`CREATE TABLE inventory_purchase_orders (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL,
      number varchar(24) NOT NULL,
      supplier_name_snapshot varchar(140) NOT NULL,
      status inventory_purchase_order_status NOT NULL DEFAULT 'DRAFT',
      order_date date NOT NULL DEFAULT CURRENT_DATE,
      expected_delivery_date date,
      notes varchar(1000),
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      ordered_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      ordered_at timestamptz,
      canceled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      canceled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_purchase_orders_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_purchase_orders_number UNIQUE(coffee_shop_id,number),
      CONSTRAINT FK_inventory_purchase_orders_supplier_tenant FOREIGN KEY(coffee_shop_id,supplier_id) REFERENCES inventory_suppliers(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_purchase_order_snapshot CHECK(length(btrim(supplier_name_snapshot)) > 0),
      CONSTRAINT CK_inventory_purchase_order_dates CHECK(expected_delivery_date IS NULL OR expected_delivery_date >= order_date),
      CONSTRAINT CK_inventory_purchase_order_audit CHECK((status='DRAFT' AND ordered_at IS NULL AND ordered_by_user_id IS NULL AND canceled_at IS NULL AND canceled_by_user_id IS NULL) OR (status='ORDERED' AND ordered_at IS NOT NULL AND ordered_by_user_id IS NOT NULL AND canceled_at IS NULL) OR (status IN ('PARTIALLY_RECEIVED','RECEIVED') AND ordered_at IS NOT NULL AND canceled_at IS NULL) OR (status='CANCELED' AND canceled_at IS NOT NULL AND canceled_by_user_id IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX IDX_inventory_purchase_orders_tenant_status_date ON inventory_purchase_orders(coffee_shop_id,status,created_at DESC)`);
    await q.query(`CREATE TABLE inventory_purchase_order_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      purchase_order_id uuid NOT NULL,
      inventory_item_id uuid NOT NULL,
      item_name_snapshot varchar(140) NOT NULL,
      quantity_display numeric(20,6) NOT NULL,
      unit varchar(16) NOT NULL,
      quantity_base numeric(20,6) NOT NULL,
      unit_price_toman bigint NOT NULL,
      note varchar(240),
      CONSTRAINT UQ_inventory_purchase_order_items_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_purchase_order_items_item UNIQUE(coffee_shop_id,purchase_order_id,inventory_item_id),
      CONSTRAINT FK_inventory_purchase_order_items_order_tenant FOREIGN KEY(coffee_shop_id,purchase_order_id) REFERENCES inventory_purchase_orders(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT FK_inventory_purchase_order_items_item_tenant FOREIGN KEY(coffee_shop_id,inventory_item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_purchase_order_item_values CHECK(quantity_display > 0 AND quantity_base > 0 AND unit_price_toman >= 0),
      CONSTRAINT CK_inventory_purchase_order_item_snapshot CHECK(length(btrim(item_name_snapshot)) > 0)
    )`);
    await q.query(`CREATE TABLE inventory_goods_receipts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL,
      purchase_order_id uuid,
      number varchar(24) NOT NULL,
      supplier_name_snapshot varchar(140) NOT NULL,
      status inventory_goods_receipt_status NOT NULL DEFAULT 'DRAFT',
      supplier_invoice_number varchar(100),
      delivery_note_number varchar(100),
      notes varchar(1000),
      received_at timestamptz,
      created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      posted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
      posted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_goods_receipts_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT UQ_inventory_goods_receipts_number UNIQUE(coffee_shop_id,number),
      CONSTRAINT FK_inventory_goods_receipts_supplier_tenant FOREIGN KEY(coffee_shop_id,supplier_id) REFERENCES inventory_suppliers(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_goods_receipts_order_tenant FOREIGN KEY(coffee_shop_id,purchase_order_id) REFERENCES inventory_purchase_orders(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_goods_receipt_snapshot CHECK(length(btrim(supplier_name_snapshot)) > 0),
      CONSTRAINT CK_inventory_goods_receipt_posting CHECK((status='DRAFT' AND posted_at IS NULL AND posted_by_user_id IS NULL AND received_at IS NULL) OR (status='POSTED' AND posted_at IS NOT NULL AND posted_by_user_id IS NOT NULL AND received_at IS NOT NULL))
    )`);
    await q.query(`CREATE INDEX IDX_inventory_goods_receipts_tenant_status_date ON inventory_goods_receipts(coffee_shop_id,status,created_at DESC)`);
    await q.query(`CREATE INDEX IDX_inventory_goods_receipts_order ON inventory_goods_receipts(coffee_shop_id,purchase_order_id)`);
    await q.query(`CREATE TABLE inventory_goods_receipt_lines (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
      goods_receipt_id uuid NOT NULL,
      purchase_order_item_id uuid,
      inventory_item_id uuid NOT NULL,
      item_name_snapshot varchar(140) NOT NULL,
      location_id uuid NOT NULL,
      quantity_display numeric(20,6) NOT NULL,
      unit varchar(16) NOT NULL,
      quantity_base numeric(20,6) NOT NULL,
      unit_price_toman bigint NOT NULL,
      total_cost_toman bigint NOT NULL,
      note varchar(500),
      movement_id uuid,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT UQ_inventory_goods_receipt_lines_tenant_id UNIQUE(coffee_shop_id,id),
      CONSTRAINT FK_inventory_goods_receipt_lines_receipt_tenant FOREIGN KEY(coffee_shop_id,goods_receipt_id) REFERENCES inventory_goods_receipts(coffee_shop_id,id) ON DELETE CASCADE,
      CONSTRAINT FK_inventory_goods_receipt_lines_order_item_tenant FOREIGN KEY(coffee_shop_id,purchase_order_item_id) REFERENCES inventory_purchase_order_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_goods_receipt_lines_item_tenant FOREIGN KEY(coffee_shop_id,inventory_item_id) REFERENCES inventory_items(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_goods_receipt_lines_location_tenant FOREIGN KEY(coffee_shop_id,location_id) REFERENCES inventory_locations(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT FK_inventory_goods_receipt_lines_movement_tenant FOREIGN KEY(coffee_shop_id,movement_id) REFERENCES inventory_stock_movements(coffee_shop_id,id) ON DELETE RESTRICT,
      CONSTRAINT CK_inventory_goods_receipt_line_values CHECK(quantity_display > 0 AND quantity_base > 0 AND unit_price_toman >= 0 AND total_cost_toman >= 0),
      CONSTRAINT CK_inventory_goods_receipt_line_snapshot CHECK(length(btrim(item_name_snapshot)) > 0)
    )`);
    await q.query(`CREATE INDEX IDX_inventory_goods_receipt_lines_order_item ON inventory_goods_receipt_lines(coffee_shop_id,purchase_order_item_id)`);
    await q.query(`CREATE INDEX IDX_inventory_goods_receipt_lines_supplier_history ON inventory_goods_receipt_lines(coffee_shop_id,inventory_item_id,goods_receipt_id)`);

    await q.query(`CREATE FUNCTION validate_inventory_receipt_order() RETURNS trigger AS $$
      DECLARE order_supplier uuid;
      BEGIN
        IF NEW.purchase_order_id IS NOT NULL THEN
          SELECT supplier_id INTO order_supplier FROM inventory_purchase_orders WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.purchase_order_id;
          IF order_supplier IS NULL OR order_supplier <> NEW.supplier_id THEN RAISE EXCEPTION 'receipt supplier must match purchase order'; END IF;
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_receipt_order BEFORE INSERT OR UPDATE OF coffee_shop_id,supplier_id,purchase_order_id ON inventory_goods_receipts FOR EACH ROW EXECUTE FUNCTION validate_inventory_receipt_order()`);
    await q.query(`CREATE FUNCTION validate_inventory_receipt_line() RETURNS trigger AS $$
      DECLARE receipt_order uuid; order_item uuid; order_item_order uuid;
      BEGIN
        SELECT purchase_order_id INTO receipt_order FROM inventory_goods_receipts WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.goods_receipt_id;
        IF NEW.purchase_order_item_id IS NOT NULL THEN
          SELECT inventory_item_id,purchase_order_id INTO order_item,order_item_order FROM inventory_purchase_order_items WHERE coffee_shop_id=NEW.coffee_shop_id AND id=NEW.purchase_order_item_id;
          IF receipt_order IS NULL OR order_item_order IS DISTINCT FROM receipt_order OR order_item IS DISTINCT FROM NEW.inventory_item_id THEN RAISE EXCEPTION 'receipt line must match its purchase order item'; END IF;
        ELSIF receipt_order IS NOT NULL THEN
          RAISE EXCEPTION 'purchase order receipt lines require an order item';
        END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_receipt_line_order BEFORE INSERT OR UPDATE OF coffee_shop_id,goods_receipt_id,purchase_order_item_id,inventory_item_id ON inventory_goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION validate_inventory_receipt_line()`);
    await q.query(`CREATE FUNCTION protect_inventory_purchase_order() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN RAISE EXCEPTION 'purchase orders are retained'; END IF;
        IF OLD.status <> 'DRAFT' AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name_snapshot IS DISTINCT FROM OLD.supplier_name_snapshot OR NEW.number IS DISTINCT FROM OLD.number OR NEW.order_date IS DISTINCT FROM OLD.order_date OR NEW.expected_delivery_date IS DISTINCT FROM OLD.expected_delivery_date OR NEW.notes IS DISTINCT FROM OLD.notes) THEN RAISE EXCEPTION 'ordered purchase order details are immutable'; END IF;
        IF NEW.status IS DISTINCT FROM OLD.status AND NOT ((OLD.status='DRAFT' AND NEW.status IN ('ORDERED','CANCELED')) OR (OLD.status='ORDERED' AND NEW.status IN ('PARTIALLY_RECEIVED','RECEIVED','CANCELED')) OR (OLD.status='PARTIALLY_RECEIVED' AND NEW.status IN ('RECEIVED','CANCELED'))) THEN RAISE EXCEPTION 'invalid purchase order status transition'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_purchase_order_protection BEFORE UPDATE OR DELETE ON inventory_purchase_orders FOR EACH ROW EXECUTE FUNCTION protect_inventory_purchase_order()`);
    await q.query(`CREATE FUNCTION protect_inventory_purchase_order_item() RETURNS trigger AS $$
      DECLARE current_status inventory_purchase_order_status;
      BEGIN
        SELECT status INTO current_status FROM inventory_purchase_orders WHERE coffee_shop_id=COALESCE(NEW.coffee_shop_id,OLD.coffee_shop_id) AND id=COALESCE(NEW.purchase_order_id,OLD.purchase_order_id);
        IF current_status IS DISTINCT FROM 'DRAFT' THEN RAISE EXCEPTION 'ordered purchase order items are immutable'; END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_purchase_order_item_protection BEFORE INSERT OR UPDATE OR DELETE ON inventory_purchase_order_items FOR EACH ROW EXECUTE FUNCTION protect_inventory_purchase_order_item()`);
    await q.query(`CREATE FUNCTION protect_inventory_goods_receipt() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF; RETURN OLD; END IF;
        IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF;
        IF NEW.status='POSTED' AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name_snapshot IS DISTINCT FROM OLD.supplier_name_snapshot OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.supplier_invoice_number IS DISTINCT FROM OLD.supplier_invoice_number OR NEW.delivery_note_number IS DISTINCT FROM OLD.delivery_note_number OR NEW.notes IS DISTINCT FROM OLD.notes) THEN RAISE EXCEPTION 'receipt content cannot change while posting'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_goods_receipt_protection BEFORE UPDATE OR DELETE ON inventory_goods_receipts FOR EACH ROW EXECUTE FUNCTION protect_inventory_goods_receipt()`);
    await q.query(`CREATE FUNCTION protect_inventory_goods_receipt_line() RETURNS trigger AS $$
      DECLARE receipt_status inventory_goods_receipt_status;
      BEGIN
        SELECT status INTO receipt_status FROM inventory_goods_receipts WHERE coffee_shop_id=COALESCE(NEW.coffee_shop_id,OLD.coffee_shop_id) AND id=COALESCE(NEW.goods_receipt_id,OLD.goods_receipt_id);
        IF receipt_status='POSTED' THEN RAISE EXCEPTION 'posted goods receipt lines are immutable'; END IF;
        IF TG_OP='DELETE' THEN RETURN OLD; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
    await q.query(`CREATE TRIGGER TRG_inventory_goods_receipt_line_protection BEFORE INSERT OR UPDATE OR DELETE ON inventory_goods_receipt_lines FOR EACH ROW EXECUTE FUNCTION protect_inventory_goods_receipt_line()`);
  }

  async down(q: QueryRunner) {
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_goods_receipt_line_protection ON inventory_goods_receipt_lines`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_goods_receipt_protection ON inventory_goods_receipts`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_purchase_order_item_protection ON inventory_purchase_order_items`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_purchase_order_protection ON inventory_purchase_orders`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_receipt_line_order ON inventory_goods_receipt_lines`);
    await q.query(`DROP TRIGGER IF EXISTS TRG_inventory_receipt_order ON inventory_goods_receipts`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_goods_receipt_line()`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_goods_receipt()`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_purchase_order_item()`);
    await q.query(`DROP FUNCTION IF EXISTS protect_inventory_purchase_order()`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_receipt_line()`);
    await q.query(`DROP FUNCTION IF EXISTS validate_inventory_receipt_order()`);
    await q.query(`DROP TABLE IF EXISTS inventory_goods_receipt_lines,inventory_goods_receipts,inventory_purchase_order_items,inventory_purchase_orders,inventory_suppliers,inventory_document_sequences CASCADE`);
    await q.query(`DROP TYPE IF EXISTS inventory_goods_receipt_status,inventory_purchase_order_status`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_goods_receipt_lines_supplier_history`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_goods_receipt_lines_order_item`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_goods_receipts_order`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_goods_receipts_tenant_status_date`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_purchase_orders_tenant_status_date`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_suppliers_tenant_active`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_suppliers_tenant_name`);
    await q.query(`DROP INDEX IF EXISTS IDX_inventory_movement_source`);
    await q.query(`DROP INDEX IF EXISTS UQ_inventory_movement_source_line`);
    await q.query(`ALTER TABLE inventory_stock_movements DROP COLUMN IF EXISTS total_cost_toman,DROP COLUMN IF EXISTS source_line_id`);
    await q.query(`ALTER TABLE inventory_stock_balances DROP COLUMN IF EXISTS average_unit_cost_toman`);
  }
}
