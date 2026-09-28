import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmNotes1790600000000 implements MigrationInterface {
  name = "TenantCrmNotes1790600000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions(scope,key,description)
      VALUES ('TENANT','tenant_crm.manage','Manage tenant CRM relationship data')
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions(role_id,permission_id)
      SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
      WHERE r.scope='TENANT' AND r.key='owner' AND p.key='tenant_crm.manage'
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_client_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        body text NOT NULL CHECK (char_length(btrim(body)) BETWEEN 1 AND 4000),
        created_by_user_id uuid NOT NULL,
        updated_by_user_id uuid,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT FK_tenant_crm_notes_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_notes_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_notes_editor FOREIGN KEY (coffee_shop_id,updated_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_notes_client_created ON tenant_crm_client_notes(coffee_shop_id,client_id,created_at DESC,id DESC) WHERE archived_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_client_notes`);
    await queryRunner.query(`DELETE FROM role_permissions WHERE permission_id=(SELECT id FROM permissions WHERE key='tenant_crm.manage')`);
    await queryRunner.query(`DELETE FROM permissions WHERE key='tenant_crm.manage'`);
  }
}
