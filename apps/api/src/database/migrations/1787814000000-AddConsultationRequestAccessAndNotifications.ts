import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConsultationRequestAccessAndNotifications1787814000000 implements MigrationInterface {
  name = "AddConsultationRequestAccessAndNotifications1787814000000";

  async up(queryRunner: QueryRunner) {
    await queryRunner.query(`ALTER TABLE "notification_deliveries" ALTER COLUMN "coffee_shop_id" DROP NOT NULL`);
    await queryRunner.query(`INSERT INTO "permissions" ("scope", "key", "description") VALUES ('PLATFORM', 'consultation_requests.read', 'View platform consultation requests') ON CONFLICT ("key") DO NOTHING`);
    await queryRunner.query(`INSERT INTO "role_permissions" ("role_id", "permission_id") SELECT r.id, p.id FROM "roles" r CROSS JOIN "permissions" p WHERE r.key='platform_owner' AND r.scope='PLATFORM' AND p.key='consultation_requests.read' ON CONFLICT DO NOTHING`);
  }

  async down(queryRunner: QueryRunner) {
    await queryRunner.query(`DELETE FROM "permissions" WHERE "key"='consultation_requests.read'`);
    await queryRunner.query(`DELETE FROM "notification_deliveries" WHERE "coffee_shop_id" IS NULL`);
    await queryRunner.query(`ALTER TABLE "notification_deliveries" ALTER COLUMN "coffee_shop_id" SET NOT NULL`);
  }
}
