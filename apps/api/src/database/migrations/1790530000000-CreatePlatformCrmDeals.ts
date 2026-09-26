import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformCrmDeals1790530000000 implements MigrationInterface {
  name = "CreatePlatformCrmDeals1790530000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("UPDATE permissions SET description='View Platform CRM organizations, contacts, leads, and deals' WHERE key='crm.read'");
    await queryRunner.query("UPDATE permissions SET description='Create, edit, assign, qualify, convert, manage deals, archive, and restore Platform CRM records' WHERE key='crm.manage'");
    await queryRunner.query("ALTER TABLE crm_contacts ADD CONSTRAINT uq_crm_contacts_id_org UNIQUE (id, organization_id)");
    await queryRunner.query("ALTER TABLE crm_leads ADD CONSTRAINT uq_crm_leads_id_org UNIQUE (id, organization_id)");
    await queryRunner.query(`
      CREATE TABLE crm_deals (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid NOT NULL,
        primary_contact_id uuid,
        originating_lead_id uuid,
        owner_id uuid,
        expected_plan_id uuid,
        pipeline_key varchar(40) NOT NULL DEFAULT 'ucafe-default',
        title varchar(200) NOT NULL,
        estimated_amount_toman bigint,
        expected_close_date date,
        stage varchar(32) NOT NULL DEFAULT 'DISCOVERY',
        status varchar(16) NOT NULL DEFAULT 'OPEN',
        loss_reason varchar(24),
        loss_reason_detail varchar(500),
        closed_at timestamptz,
        won_at timestamptz,
        lost_at timestamptz,
        created_by_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_deals_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_deals_contact_org FOREIGN KEY (primary_contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_deals_originating_lead_org FOREIGN KEY (originating_lead_id, organization_id) REFERENCES crm_leads(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_deals_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_deals_expected_plan FOREIGN KEY (expected_plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_deals_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_deals_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_deals_pipeline CHECK (pipeline_key = 'ucafe-default'),
        CONSTRAINT ck_crm_deals_title_nonblank CHECK (length(btrim(title)) > 0),
        CONSTRAINT ck_crm_deals_amount_nonnegative CHECK (estimated_amount_toman IS NULL OR estimated_amount_toman >= 0),
        CONSTRAINT ck_crm_deals_stage CHECK (stage IN ('DISCOVERY','DEMO_SCHEDULED','DEMO_COMPLETED','TRIAL_PROPOSED','TRIAL_ACTIVE','DECISION')),
        CONSTRAINT ck_crm_deals_status CHECK (status IN ('OPEN','WON','LOST')),
        CONSTRAINT ck_crm_deals_loss_reason CHECK (loss_reason IS NULL OR loss_reason IN ('PRICE','TIMING','PRODUCT_FIT','NO_RESPONSE','COMPETITOR','OTHER')),
        CONSTRAINT ck_crm_deals_outcome_fields CHECK (
          (status='OPEN' AND closed_at IS NULL AND won_at IS NULL AND lost_at IS NULL AND loss_reason IS NULL AND loss_reason_detail IS NULL)
          OR (status='WON' AND closed_at IS NOT NULL AND won_at IS NOT NULL AND closed_at=won_at AND lost_at IS NULL AND loss_reason IS NULL AND loss_reason_detail IS NULL)
          OR (status='LOST' AND closed_at IS NOT NULL AND lost_at IS NOT NULL AND closed_at=lost_at AND won_at IS NULL AND loss_reason IS NOT NULL)
        ),
        CONSTRAINT ck_crm_deals_loss_detail CHECK (loss_reason_detail IS NULL OR loss_reason='OTHER')
      )
    `);
    await queryRunner.query("CREATE INDEX idx_crm_deals_active_stage_updated ON crm_deals(pipeline_key,status,stage,updated_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_deals_active_owner_status ON crm_deals(owner_id,status,updated_at DESC) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_deals_organization_created ON crm_deals(organization_id,created_at DESC,id)");
    await queryRunner.query("CREATE INDEX idx_crm_deals_active_plan ON crm_deals(expected_plan_id) WHERE archived_at IS NULL AND expected_plan_id IS NOT NULL");
    await queryRunner.query("CREATE INDEX idx_crm_deals_active_close_date ON crm_deals(expected_close_date) WHERE archived_at IS NULL AND expected_close_date IS NOT NULL");
    await queryRunner.query("CREATE UNIQUE INDEX uq_crm_deals_originating_lead ON crm_deals(originating_lead_id) WHERE originating_lead_id IS NOT NULL");
    await queryRunner.query(`
      CREATE TABLE crm_deal_stage_history (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        deal_id uuid NOT NULL,
        pipeline_key varchar(40) NOT NULL,
        from_stage varchar(32),
        to_stage varchar(32) NOT NULL,
        reason varchar(500),
        changed_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_deal_stage_history_deal FOREIGN KEY (deal_id) REFERENCES crm_deals(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_deal_stage_history_actor FOREIGN KEY (changed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_deal_stage_history_pipeline CHECK (pipeline_key = 'ucafe-default'),
        CONSTRAINT ck_crm_deal_stage_history_from CHECK (from_stage IS NULL OR from_stage IN ('DISCOVERY','DEMO_SCHEDULED','DEMO_COMPLETED','TRIAL_PROPOSED','TRIAL_ACTIVE','DECISION')),
        CONSTRAINT ck_crm_deal_stage_history_to CHECK (to_stage IN ('DISCOVERY','DEMO_SCHEDULED','DEMO_COMPLETED','TRIAL_PROPOSED','TRIAL_ACTIVE','DECISION')),
        CONSTRAINT ck_crm_deal_stage_history_changed CHECK (from_stage IS NULL OR from_stage <> to_stage)
      )
    `);
    await queryRunner.query("CREATE INDEX idx_crm_deal_stage_history_deal_created ON crm_deal_stage_history(deal_id,created_at,id)");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE crm_deal_stage_history");
    await queryRunner.query("DROP TABLE crm_deals");
    await queryRunner.query("ALTER TABLE crm_leads DROP CONSTRAINT uq_crm_leads_id_org");
    await queryRunner.query("ALTER TABLE crm_contacts DROP CONSTRAINT uq_crm_contacts_id_org");
    await queryRunner.query("UPDATE permissions SET description='View Platform CRM organizations and contacts' WHERE key='crm.read'");
    await queryRunner.query("UPDATE permissions SET description='Create, edit, archive, and restore Platform CRM organizations and contacts' WHERE key='crm.manage'");
  }
}
