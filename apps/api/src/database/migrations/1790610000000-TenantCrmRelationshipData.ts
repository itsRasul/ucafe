import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmRelationshipData1790610000000 implements MigrationInterface {
  name = "TenantCrmRelationshipData1790610000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE tenant_crm_client_profiles (
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        preferred_seating varchar(80),
        favorite_drink varchar(120),
        dietary_notes varchar(500),
        allergy_notes varchar(500),
        birthday_month_day varchar(5) CHECK (birthday_month_day IS NULL OR birthday_month_day ~ '^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'),
        updated_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (coffee_shop_id,client_id),
        CONSTRAINT FK_tenant_crm_profiles_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_profiles_editor FOREIGN KEY (coffee_shop_id,updated_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_tags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        name varchar(80) NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
        created_by_user_id uuid NOT NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_tags_tenant_id UNIQUE (coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_tags_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_tags_active_name ON tenant_crm_tags(coffee_shop_id,lower(name)) WHERE archived_at IS NULL`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_client_tags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        tag_id uuid NOT NULL,
        created_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_client_tags UNIQUE (coffee_shop_id,client_id,tag_id),
        CONSTRAINT FK_tenant_crm_client_tags_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_client_tags_tag FOREIGN KEY (coffee_shop_id,tag_id)
          REFERENCES tenant_crm_tags(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_client_tags_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_client_tags_tag ON tenant_crm_client_tags(coffee_shop_id,tag_id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_custom_field_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        key varchar(64) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
        label varchar(120) NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
        description varchar(500),
        data_type varchar(20) NOT NULL CHECK (data_type IN ('TEXT','LONG_TEXT','NUMBER','BOOLEAN','DATE','SINGLE_SELECT','MULTI_SELECT','URL')),
        required boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
        created_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_fields_tenant_id UNIQUE (coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_fields_tenant_key UNIQUE (coffee_shop_id,key),
        CONSTRAINT FK_tenant_crm_fields_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_fields_active_order ON tenant_crm_custom_field_definitions(coffee_shop_id,active,sort_order,id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_custom_field_options (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        field_definition_id uuid NOT NULL,
        label varchar(120) NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 120),
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_field_options_tenant_id UNIQUE (coffee_shop_id,field_definition_id,id),
        CONSTRAINT FK_tenant_crm_field_options_definition FOREIGN KEY (coffee_shop_id,field_definition_id)
          REFERENCES tenant_crm_custom_field_definitions(coffee_shop_id,id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_field_options_order ON tenant_crm_custom_field_options(coffee_shop_id,field_definition_id,active,sort_order,id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_client_custom_field_values (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        field_definition_id uuid NOT NULL,
        value jsonb NOT NULL CHECK (jsonb_typeof(value) IN ('string','number','boolean','array')),
        updated_by_user_id uuid NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT UQ_tenant_crm_client_field_value UNIQUE (coffee_shop_id,client_id,field_definition_id),
        CONSTRAINT FK_tenant_crm_field_values_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_field_values_definition FOREIGN KEY (coffee_shop_id,field_definition_id)
          REFERENCES tenant_crm_custom_field_definitions(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_field_values_editor FOREIGN KEY (coffee_shop_id,updated_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_client_field_values_client ON tenant_crm_client_custom_field_values(coffee_shop_id,client_id)`);
    await queryRunner.query(`
      CREATE TABLE tenant_crm_reminders (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        client_id uuid NOT NULL,
        title varchar(200) NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
        description varchar(4000),
        due_at timestamptz NOT NULL,
        status varchar(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','COMPLETED','CANCELED')),
        assigned_to_user_id uuid,
        created_by_user_id uuid NOT NULL,
        updated_by_user_id uuid,
        completed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT CK_tenant_crm_reminder_completed CHECK ((status='COMPLETED')=(completed_at IS NOT NULL)),
        CONSTRAINT FK_tenant_crm_reminders_client FOREIGN KEY (coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_reminders_creator FOREIGN KEY (coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_reminders_editor FOREIGN KEY (coffee_shop_id,updated_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_reminders_assignee FOREIGN KEY (coffee_shop_id,assigned_to_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_reminders_client_due ON tenant_crm_reminders(coffee_shop_id,client_id,status,due_at,id)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_reminders_tenant_due ON tenant_crm_reminders(coffee_shop_id,status,due_at,id)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_reminders_assignee_due ON tenant_crm_reminders(coffee_shop_id,assigned_to_user_id,status,due_at,id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE tenant_crm_reminders`);
    await queryRunner.query(`DROP TABLE tenant_crm_client_custom_field_values`);
    await queryRunner.query(`DROP TABLE tenant_crm_custom_field_options`);
    await queryRunner.query(`DROP TABLE tenant_crm_custom_field_definitions`);
    await queryRunner.query(`DROP TABLE tenant_crm_client_tags`);
    await queryRunner.query(`DROP TABLE tenant_crm_tags`);
    await queryRunner.query(`DROP TABLE tenant_crm_client_profiles`);
  }
}
