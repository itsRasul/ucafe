import { MigrationInterface, QueryRunner } from "typeorm";

export class CustomerAnalyticsIndex1787883600000 implements MigrationInterface {
  name = "CustomerAnalyticsIndex1787883600000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE INDEX "IDX_orders_tenant_status_client_changed" ON "orders" ("coffee_shop_id", "status", "client_id", "status_changed_at")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_orders_tenant_status_client_changed"`);
  }
}
