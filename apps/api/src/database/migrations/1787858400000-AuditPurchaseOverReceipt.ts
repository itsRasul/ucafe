import { MigrationInterface, QueryRunner } from "typeorm";

export class AuditPurchaseOverReceipt1787858400000 implements MigrationInterface {
  name = "AuditPurchaseOverReceipt1787858400000";

  async up(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_goods_receipts ADD COLUMN over_receive_confirmed boolean NOT NULL DEFAULT false,
      ADD CONSTRAINT CK_inventory_receipt_over_receive CHECK(NOT over_receive_confirmed OR (status='POSTED' AND purchase_order_id IS NOT NULL))`);
    await q.query(`CREATE OR REPLACE FUNCTION protect_inventory_goods_receipt() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF; RETURN OLD; END IF;
        IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF;
        IF NEW.status='POSTED' AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name_snapshot IS DISTINCT FROM OLD.supplier_name_snapshot OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.supplier_invoice_number IS DISTINCT FROM OLD.supplier_invoice_number OR NEW.delivery_note_number IS DISTINCT FROM OLD.delivery_note_number OR NEW.notes IS DISTINCT FROM OLD.notes) THEN RAISE EXCEPTION 'receipt content cannot change while posting'; END IF;
        IF NEW.over_receive_confirmed IS DISTINCT FROM OLD.over_receive_confirmed AND NOT (OLD.status='DRAFT' AND NEW.status='POSTED' AND NEW.over_receive_confirmed) THEN RAISE EXCEPTION 'over-receive confirmation is set only while posting'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
  }

  async down(q: QueryRunner) {
    await q.query(`ALTER TABLE inventory_goods_receipts DROP CONSTRAINT IF EXISTS CK_inventory_receipt_over_receive,DROP COLUMN IF EXISTS over_receive_confirmed`);
    await q.query(`CREATE OR REPLACE FUNCTION protect_inventory_goods_receipt() RETURNS trigger AS $$
      BEGIN
        IF TG_OP='DELETE' THEN IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF; RETURN OLD; END IF;
        IF OLD.status='POSTED' THEN RAISE EXCEPTION 'posted goods receipts are immutable'; END IF;
        IF NEW.status='POSTED' AND (NEW.supplier_id IS DISTINCT FROM OLD.supplier_id OR NEW.supplier_name_snapshot IS DISTINCT FROM OLD.supplier_name_snapshot OR NEW.purchase_order_id IS DISTINCT FROM OLD.purchase_order_id OR NEW.number IS DISTINCT FROM OLD.number OR NEW.supplier_invoice_number IS DISTINCT FROM OLD.supplier_invoice_number OR NEW.delivery_note_number IS DISTINCT FROM OLD.delivery_note_number OR NEW.notes IS DISTINCT FROM OLD.notes) THEN RAISE EXCEPTION 'receipt content cannot change while posting'; END IF;
        RETURN NEW;
      END;
    $$ LANGUAGE plpgsql`);
  }
}
