import { MigrationInterface, QueryRunner } from "typeorm";

export class PlatformCrmFieldsTagsViewsSegments1790560000000 implements MigrationInterface {
  name = "PlatformCrmFieldsTagsViewsSegments1790560000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE crm_organizations ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object');
      ALTER TABLE crm_contacts ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object');
      ALTER TABLE crm_leads ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object');
      ALTER TABLE crm_deals ADD COLUMN custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(custom_fields)='object');

      CREATE TABLE crm_custom_field_definitions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        entity_type varchar(24) NOT NULL CHECK (entity_type IN ('ORGANIZATION','CONTACT','LEAD','DEAL')),
        key varchar(64) NOT NULL CHECK (key ~ '^[a-z][a-z0-9_]{0,63}$'),
        label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
        description varchar(500),
        data_type varchar(24) NOT NULL CHECK (data_type IN ('TEXT','LONG_TEXT','NUMBER','BOOLEAN','DATE','SINGLE_SELECT','MULTI_SELECT','URL')),
        required boolean NOT NULL DEFAULT false,
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (entity_type, key)
      );
      CREATE INDEX idx_crm_custom_field_active_order ON crm_custom_field_definitions(entity_type, active, sort_order, id);

      CREATE TABLE crm_custom_field_options (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        field_definition_id uuid NOT NULL REFERENCES crm_custom_field_definitions(id) ON DELETE RESTRICT,
        label varchar(120) NOT NULL CHECK (length(trim(label)) > 0),
        active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_custom_field_option_order ON crm_custom_field_options(field_definition_id, active, sort_order, id);

      CREATE TABLE crm_tags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(80) NOT NULL CHECK (length(trim(name)) > 0),
        normalized_name varchar(80) NOT NULL UNIQUE,
        description varchar(500),
        color varchar(24),
        active boolean NOT NULL DEFAULT true,
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );

      CREATE TABLE crm_entity_tags (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tag_id uuid NOT NULL REFERENCES crm_tags(id) ON DELETE RESTRICT,
        organization_id uuid REFERENCES crm_organizations(id) ON DELETE CASCADE,
        contact_id uuid REFERENCES crm_contacts(id) ON DELETE CASCADE,
        lead_id uuid REFERENCES crm_leads(id) ON DELETE CASCADE,
        deal_id uuid REFERENCES crm_deals(id) ON DELETE CASCADE,
        assigned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CHECK (num_nonnulls(organization_id,contact_id,lead_id,deal_id)=1)
      );
      CREATE UNIQUE INDEX uq_crm_entity_tag_organization ON crm_entity_tags(tag_id,organization_id) WHERE organization_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_crm_entity_tag_contact ON crm_entity_tags(tag_id,contact_id) WHERE contact_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_crm_entity_tag_lead ON crm_entity_tags(tag_id,lead_id) WHERE lead_id IS NOT NULL;
      CREATE UNIQUE INDEX uq_crm_entity_tag_deal ON crm_entity_tags(tag_id,deal_id) WHERE deal_id IS NOT NULL;
      CREATE INDEX idx_crm_entity_tag_organization ON crm_entity_tags(organization_id,tag_id) WHERE organization_id IS NOT NULL;
      CREATE INDEX idx_crm_entity_tag_contact ON crm_entity_tags(contact_id,tag_id) WHERE contact_id IS NOT NULL;
      CREATE INDEX idx_crm_entity_tag_lead ON crm_entity_tags(lead_id,tag_id) WHERE lead_id IS NOT NULL;
      CREATE INDEX idx_crm_entity_tag_deal ON crm_entity_tags(deal_id,tag_id) WHERE deal_id IS NOT NULL;

      CREATE TABLE crm_saved_views (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
        entity_type varchar(24) NOT NULL CHECK (entity_type IN ('ORGANIZATION','CONTACT','LEAD','DEAL')),
        visibility varchar(16) NOT NULL CHECK (visibility IN ('PRIVATE','SHARED')),
        owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        filter_definition jsonb NOT NULL CHECK (jsonb_typeof(filter_definition)='object'),
        query_definition jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(query_definition)='object'),
        sort_definition jsonb CHECK (sort_definition IS NULL OR jsonb_typeof(sort_definition)='object'),
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_saved_views_entity_owner ON crm_saved_views(entity_type,owner_id,archived_at);
      CREATE INDEX idx_crm_saved_views_shared ON crm_saved_views(entity_type,archived_at) WHERE visibility='SHARED';

      CREATE TABLE crm_segments (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL CHECK (length(trim(name)) > 0),
        description varchar(500),
        entity_type varchar(24) NOT NULL CHECK (entity_type IN ('ORGANIZATION','CONTACT','LEAD','DEAL')),
        filter_definition jsonb NOT NULL CHECK (jsonb_typeof(filter_definition)='object'),
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE INDEX idx_crm_segments_entity_active ON crm_segments(entity_type,archived_at,created_at DESC);
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE crm_segments;
      DROP TABLE crm_saved_views;
      DROP TABLE crm_entity_tags;
      DROP TABLE crm_tags;
      DROP TABLE crm_custom_field_options;
      DROP TABLE crm_custom_field_definitions;
      ALTER TABLE crm_organizations DROP COLUMN custom_fields;
      ALTER TABLE crm_contacts DROP COLUMN custom_fields;
      ALTER TABLE crm_leads DROP COLUMN custom_fields;
      ALTER TABLE crm_deals DROP COLUMN custom_fields;
    `);
  }
}
