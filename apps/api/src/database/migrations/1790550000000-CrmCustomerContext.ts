import { MigrationInterface, QueryRunner } from "typeorm";

export class CrmCustomerContext1790550000000 implements MigrationInterface {
  name = "CrmCustomerContext1790550000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (scope, key, description)
      VALUES ('PLATFORM', 'subscriptions.read', 'View limited tenant subscription context')
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT rp.role_id, read_permission.id
      FROM role_permissions rp
      JOIN permissions source_permission ON source_permission.id=rp.permission_id
      JOIN permissions read_permission ON read_permission.key='subscriptions.read'
      WHERE source_permission.key IN ('crm.read', 'subscriptions.manage')
      ON CONFLICT DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key='subscriptions.read')`);
    await queryRunner.query(`DELETE FROM permissions WHERE key='subscriptions.read'`);
  }
}
