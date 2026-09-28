import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmDirectory1790590000000 implements MigrationInterface {
  name = "TenantCrmDirectory1790590000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions(scope,key,description)
      VALUES ('TENANT','tenant_crm.read','View the tenant customer directory')
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE r.scope='TENANT' AND r.key='owner' AND p.key='tenant_crm.read'
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      UPDATE subscription_plans
      SET features=jsonb_set(COALESCE(features,'{}'::jsonb),'{tenant_crm}',to_jsonb(key='golden'),true)
      WHERE NOT (COALESCE(features,'{}'::jsonb) ? 'tenant_crm')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE subscription_plans SET features=features-'tenant_crm'`);
    await queryRunner.query(`DELETE FROM role_permissions WHERE permission_id=(SELECT id FROM permissions WHERE key='tenant_crm.read')`);
    await queryRunner.query(`DELETE FROM permissions WHERE key='tenant_crm.read'`);
  }
}
