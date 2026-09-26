import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformCrmLeads1790520000000 implements MigrationInterface {
  name = "CreatePlatformCrmLeads1790520000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`UPDATE permissions SET description='View Platform CRM organizations, contacts, and leads' WHERE key='crm.read'`);
    await queryRunner.query(`UPDATE permissions SET description='Create, edit, assign, qualify, convert, archive, and restore Platform CRM records' WHERE key='crm.manage'`);
    await queryRunner.query(`
      CREATE TABLE crm_leads (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        business_name varchar(160) NOT NULL,
        business_name_normalized varchar(160) NOT NULL,
        contact_name varchar(160),
        phone_encrypted text,
        phone_hash char(64),
        email_encrypted text,
        email_hash char(64),
        city varchar(100),
        city_normalized varchar(100),
        website varchar(500),
        website_host varchar(255),
        instagram_handle varchar(30),
        description varchar(1000),
        source varchar(24) NOT NULL DEFAULT 'MANUAL',
        status varchar(24) NOT NULL DEFAULT 'NEW',
        priority varchar(12) NOT NULL DEFAULT 'NORMAL',
        owner_id uuid,
        organization_id uuid,
        primary_contact_id uuid,
        source_request_id uuid,
        qualification_notes varchar(2000),
        unqualified_reason varchar(32),
        unqualified_reason_detail varchar(500),
        qualified_at timestamptz,
        converted_at timestamptz,
        created_by_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_leads_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_leads_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_leads_primary_contact FOREIGN KEY (primary_contact_id) REFERENCES crm_contacts(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_leads_source_request FOREIGN KEY (source_request_id) REFERENCES platform_order_requests(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_leads_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_leads_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_leads_business_name_nonblank CHECK (length(btrim(business_name)) > 0),
        CONSTRAINT ck_crm_leads_status CHECK (status IN ('NEW','ATTEMPTING_CONTACT','CONTACTED','QUALIFIED','NURTURING','UNQUALIFIED','CONVERTED')),
        CONSTRAINT ck_crm_leads_source CHECK (source IN ('OUTBOUND_CALL','LANDING_FORM','SEO','INSTAGRAM','REFERRAL','SMS','PARTNER','MANUAL','OTHER')),
        CONSTRAINT ck_crm_leads_priority CHECK (priority IN ('LOW','NORMAL','HIGH')),
        CONSTRAINT ck_crm_leads_unqualified_reason CHECK (unqualified_reason IS NULL OR unqualified_reason IN ('NOT_INTERESTED','NOT_RELEVANT','NO_BUDGET','NO_RESPONSE','DUPLICATE','INVALID_CONTACT','ALREADY_USING_COMPETITOR','TOO_EARLY','OTHER')),
        CONSTRAINT ck_crm_leads_phone_pair CHECK ((phone_encrypted IS NULL) = (phone_hash IS NULL)),
        CONSTRAINT ck_crm_leads_email_pair CHECK ((email_encrypted IS NULL) = (email_hash IS NULL)),
        CONSTRAINT ck_crm_leads_city_pair CHECK ((city IS NULL) = (city_normalized IS NULL)),
        CONSTRAINT ck_crm_leads_converted_fields CHECK (
          (status = 'CONVERTED' AND converted_at IS NOT NULL AND organization_id IS NOT NULL AND primary_contact_id IS NOT NULL)
          OR (status <> 'CONVERTED' AND converted_at IS NULL)
        ),
        CONSTRAINT ck_crm_leads_qualified_at CHECK (status NOT IN ('QUALIFIED','CONVERTED') OR qualified_at IS NOT NULL),
        CONSTRAINT ck_crm_leads_source_request CHECK (source_request_id IS NULL OR source = 'LANDING_FORM'),
        CONSTRAINT ck_crm_leads_unqualified_fields CHECK ((status = 'UNQUALIFIED') = (unqualified_reason IS NOT NULL)),
        CONSTRAINT ck_crm_leads_unqualified_detail CHECK (unqualified_reason_detail IS NULL OR unqualified_reason = 'OTHER'),
        CONSTRAINT ck_crm_leads_contact_organization CHECK (primary_contact_id IS NULL OR organization_id IS NOT NULL)
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_active_status_created ON crm_leads(status, created_at DESC, id) WHERE archived_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_active_owner_status ON crm_leads(owner_id, status, created_at DESC) WHERE archived_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_active_source_created ON crm_leads(source, created_at DESC) WHERE archived_at IS NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_organization ON crm_leads(organization_id) WHERE organization_id IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_primary_contact ON crm_leads(primary_contact_id) WHERE primary_contact_id IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_business_city ON crm_leads(business_name_normalized, city_normalized)`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_city ON crm_leads(city_normalized) WHERE city_normalized IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_phone_hash ON crm_leads(phone_hash) WHERE phone_hash IS NOT NULL`);
    await queryRunner.query(`CREATE INDEX idx_crm_leads_email_hash ON crm_leads(email_hash) WHERE email_hash IS NOT NULL`);
    await queryRunner.query(`CREATE UNIQUE INDEX uq_crm_leads_source_request_id ON crm_leads(source_request_id) WHERE source_request_id IS NOT NULL`);
    await queryRunner.query(`
      CREATE TABLE crm_lead_status_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        lead_id uuid NOT NULL,
        previous_status varchar(24),
        next_status varchar(24) NOT NULL,
        reason varchar(500),
        changed_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_lead_status_history_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_lead_status_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_lead_status_history_previous CHECK (previous_status IS NULL OR previous_status IN ('NEW','ATTEMPTING_CONTACT','CONTACTED','QUALIFIED','NURTURING','UNQUALIFIED','CONVERTED')),
        CONSTRAINT ck_crm_lead_status_history_next CHECK (next_status IN ('NEW','ATTEMPTING_CONTACT','CONTACTED','QUALIFIED','NURTURING','UNQUALIFIED','CONVERTED'))
      )
    `);
    await queryRunner.query(`CREATE INDEX idx_crm_lead_status_history_lead_created ON crm_lead_status_history(lead_id, created_at, id)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE crm_lead_status_history`);
    await queryRunner.query(`DROP TABLE crm_leads`);
    await queryRunner.query(`UPDATE permissions SET description='View Platform CRM organizations and contacts' WHERE key='crm.read'`);
    await queryRunner.query(`UPDATE permissions SET description='Create, edit, archive, and restore Platform CRM organizations and contacts' WHERE key='crm.manage'`);
  }
}
