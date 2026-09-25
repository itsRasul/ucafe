import { MigrationInterface, QueryRunner } from "typeorm";

export class ReservationAnalyticsIndexes1790337600000 implements MigrationInterface {
  name = "ReservationAnalyticsIndexes1790337600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_reservations_tenant_created_at" ON "reservations" ("coffee_shop_id", "created_at")`);
    await queryRunner.query(`CREATE INDEX "IDX_reservations_tenant_status_changed" ON "reservations" ("coffee_shop_id", "status", "status_changed_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_reservations_tenant_status_changed"`);
    await queryRunner.query(`DROP INDEX "IDX_reservations_tenant_created_at"`);
  }
}
