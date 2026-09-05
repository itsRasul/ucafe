import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateReservationFoundation1787763600000 implements MigrationInterface {
  name = "CreateReservationFoundation1787763600000";
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TYPE "reservation_status" AS ENUM ('PENDING','CONFIRMED','REJECTED','CANCELED','COMPLETED','NO_SHOW')`);
    await queryRunner.query(`CREATE TABLE "reservation_settings" ("branch_id" uuid PRIMARY KEY REFERENCES "branches"("id") ON DELETE CASCADE,"is_enabled" boolean NOT NULL DEFAULT true,"slot_interval_minutes" smallint NOT NULL DEFAULT 30,"duration_minutes" smallint NOT NULL DEFAULT 90,"minimum_party_size" smallint NOT NULL DEFAULT 1,"maximum_party_size" smallint NOT NULL DEFAULT 8,"maximum_concurrent_guests" smallint NOT NULL DEFAULT 20,"minimum_lead_minutes" integer NOT NULL DEFAULT 60,"maximum_advance_days" smallint NOT NULL DEFAULT 30,CONSTRAINT "CK_reservation_settings_values" CHECK (slot_interval_minutes BETWEEN 15 AND 120 AND duration_minutes BETWEEN 30 AND 360 AND minimum_party_size > 0 AND maximum_party_size >= minimum_party_size AND maximum_concurrent_guests >= maximum_party_size AND minimum_lead_minutes >= 0 AND maximum_advance_days BETWEEN 1 AND 365))`);
    await queryRunner.query(`CREATE TABLE "reservations" ("id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),"coffee_shop_id" uuid NOT NULL REFERENCES "coffee_shops"("id") ON DELETE RESTRICT,"branch_id" uuid NOT NULL REFERENCES "branches"("id") ON DELETE RESTRICT,"customer_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE RESTRICT,"contact_name" varchar(100) NOT NULL,"reservation_date" date NOT NULL,"start_time" time NOT NULL,"end_time" time NOT NULL,"party_size" smallint NOT NULL,"status" reservation_status NOT NULL DEFAULT 'PENDING',"customer_note" varchar(500),"staff_note" varchar(500),"status_changed_at" timestamptz,"status_changed_by_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,"created_at" timestamptz NOT NULL DEFAULT now(),"updated_at" timestamptz NOT NULL DEFAULT now(),CONSTRAINT "CK_reservations_party_size" CHECK (party_size > 0),CONSTRAINT "CK_reservations_time_range" CHECK (end_time > start_time))`);
    await queryRunner.query(`CREATE INDEX "IDX_reservations_tenant_date_status" ON "reservations" ("coffee_shop_id","reservation_date","status")`);
    await queryRunner.query(`CREATE INDEX "IDX_reservations_branch_slot" ON "reservations" ("branch_id","reservation_date","start_time","end_time")`);
    await queryRunner.query(`CREATE FUNCTION enforce_reservation_tenant_scope() RETURNS trigger AS $$ BEGIN IF NOT EXISTS (SELECT 1 FROM branches b WHERE b.id=NEW.branch_id AND b.coffee_shop_id=NEW.coffee_shop_id) THEN RAISE EXCEPTION 'reservation branch tenant mismatch'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
    await queryRunner.query(`CREATE TRIGGER "TRG_reservations_tenant_scope" BEFORE INSERT OR UPDATE ON "reservations" FOR EACH ROW EXECUTE FUNCTION enforce_reservation_tenant_scope()`);
    await queryRunner.query(`INSERT INTO "reservation_settings" ("branch_id") SELECT "id" FROM "branches" WHERE "is_primary"=true ON CONFLICT DO NOTHING`);
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "reservations"`); await queryRunner.query(`DROP TABLE "reservation_settings"`); await queryRunner.query(`DROP FUNCTION enforce_reservation_tenant_scope`); await queryRunner.query(`DROP TYPE "reservation_status"`);
  }
}
