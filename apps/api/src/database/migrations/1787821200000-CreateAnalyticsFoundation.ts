import { MigrationInterface, QueryRunner } from "typeorm";

export class CreateAnalyticsFoundation1787821200000 implements MigrationInterface {
  name = "CreateAnalyticsFoundation1787821200000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`CREATE INDEX "IDX_orders_tenant_status_changed" ON "orders" ("coffee_shop_id", "status", "status_changed_at")`);
    await queryRunner.query(`INSERT INTO "permissions" ("scope", "key", "description") VALUES ('TENANT', 'analytics.read', 'View cafe analytics') ON CONFLICT ("key") DO NOTHING`);
    await queryRunner.query(`INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p WHERE r.scope='TENANT' AND r.key='owner' AND p.key='analytics.read' ON CONFLICT DO NOTHING`);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key"='analytics.read'`);
    await queryRunner.query(`DROP INDEX "IDX_orders_tenant_status_changed"`);
  }
}
