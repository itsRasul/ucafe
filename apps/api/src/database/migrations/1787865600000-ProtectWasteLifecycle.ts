import { MigrationInterface, QueryRunner } from "typeorm";

export class ProtectWasteLifecycle1787865600000 implements MigrationInterface {
  name = "ProtectWasteLifecycle1787865600000";

  async up(q: QueryRunner) {
    await q.query(`CREATE OR REPLACE FUNCTION protect_inventory_waste_record() RETURNS trigger AS $$
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
                 (i.movement_id IS NULL OR r.id IS NULL OR r.type<>'MANUAL_ADJUSTMENT' OR r.quantity_base<>-w.quantity_base OR r.item_id<>w.item_id OR r.location_id<>w.location_id)) THEN
            RAISE EXCEPTION 'waste correction must preserve history and restore every posted line';
          END IF;
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'invalid waste record status transition';
      END;
    $$ LANGUAGE plpgsql`);
  }

  async down(q: QueryRunner) {
    await this.up(q);
  }
}
