import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformCrmOrganizationsAndContacts1790510000000 implements MigrationInterface {
  name = "CreatePlatformCrmOrganizationsAndContacts1790510000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO permissions (scope, key, description) VALUES
        ('PLATFORM', 'crm.read', 'View Platform CRM organizations and contacts'),
        ('PLATFORM', 'crm.manage', 'Create, edit, archive, and restore Platform CRM organizations and contacts')
      ON CONFLICT (key) DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO role_permissions (role_id, permission_id)
      SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
      WHERE r.key='platform_owner' AND r.scope='PLATFORM' AND p.key IN ('crm.read', 'crm.manage')
      ON CONFLICT DO NOTHING
    `);
    await queryRunner.query(`
      CREATE TABLE crm_organizations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(160) NOT NULL,
        name_normalized varchar(160) NOT NULL,
        city varchar(100),
        city_normalized varchar(100),
        website varchar(500),
        website_host varchar(255),
        instagram_handle varchar(30),
        coffee_shop_id uuid,
        created_by_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_organizations_coffee_shop FOREIGN KEY (coffee_shop_id) REFERENCES coffee_shops(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_organizations_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_organizations_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_organizations_name_nonblank CHECK (length(btrim(name)) > 0),
        CONSTRAINT ck_crm_organizations_instagram_handle CHECK (instagram_handle IS NULL OR instagram_handle ~ '^[a-z0-9._]{1,30}$'),
        CONSTRAINT ck_crm_organizations_city_pair CHECK ((city IS NULL) = (city_normalized IS NULL))
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_crm_organizations_coffee_shop_id ON crm_organizations(coffee_shop_id) WHERE coffee_shop_id IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_organizations_name_city ON crm_organizations(name_normalized, city_normalized)`);
    await queryRunner.query(`CREATE INDEX idx_crm_organizations_website_host ON crm_organizations(website_host) WHERE website_host IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_organizations_instagram_handle ON crm_organizations(instagram_handle) WHERE instagram_handle IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_organizations_active_created_at ON crm_organizations(created_at DESC, id) WHERE archived_at IS NULL`);
    await queryRunner.query(`
      CREATE TABLE crm_contacts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        role varchar(100),
        phone_encrypted text,
        phone_hash char(64),
        email_encrypted text,
        email_hash char(64),
        created_by_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_contacts_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_contacts_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_contacts_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_contacts_name_nonblank CHECK (length(btrim(name)) > 0),
        CONSTRAINT ck_crm_contacts_phone_pair CHECK ((phone_encrypted IS NULL) = (phone_hash IS NULL)),
        CONSTRAINT ck_crm_contacts_email_pair CHECK ((email_encrypted IS NULL) = (email_hash IS NULL))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_crm_contacts_organization_name ON crm_contacts(organization_id, name) WHERE archived_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_contacts_organization_phone_hash ON crm_contacts(organization_id, phone_hash) WHERE phone_hash IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_contacts_organization_email_hash ON crm_contacts(organization_id, email_hash) WHERE email_hash IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_contacts_active_created_at ON crm_contacts(created_at DESC, id) WHERE archived_at IS NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE crm_contacts`);
    await queryRunner.query(`DROP TABLE crm_organizations`);
    await queryRunner.query(`DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE key IN ('crm.read', 'crm.manage'))`);
    await queryRunner.query(`DELETE FROM permissions WHERE key IN ('crm.read', 'crm.manage')`);
  }
}
