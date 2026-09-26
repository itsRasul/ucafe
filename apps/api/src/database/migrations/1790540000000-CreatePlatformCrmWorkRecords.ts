import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePlatformCrmWorkRecords1790540000000 implements MigrationInterface {
  name = "CreatePlatformCrmWorkRecords1790540000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("UPDATE permissions SET description='View Platform CRM organizations, contacts, leads, deals, activities, tasks, and notes' WHERE key='crm.read'");
    await queryRunner.query("UPDATE permissions SET description='Manage Platform CRM records, sales work, and follow-ups' WHERE key='crm.manage'");
    await queryRunner.query("ALTER TABLE crm_deals ADD CONSTRAINT uq_crm_deals_id_org UNIQUE (id, organization_id)");

    await queryRunner.query(`
      CREATE TABLE crm_tasks (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid,
        contact_id uuid,
        lead_id uuid,
        deal_id uuid,
        title varchar(200) NOT NULL,
        description text,
        kind varchar(16) NOT NULL DEFAULT 'GENERAL',
        status varchar(16) NOT NULL DEFAULT 'OPEN',
        priority varchar(16) NOT NULL DEFAULT 'NORMAL',
        due_at timestamptz,
        assigned_to_user_id uuid,
        completed_at timestamptz,
        completed_by_user_id uuid,
        canceled_at timestamptz,
        canceled_by_user_id uuid,
        created_by_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        archived_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_tasks_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_tasks_contact_org FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_tasks_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_tasks_lead_org FOREIGN KEY (lead_id, organization_id) REFERENCES crm_leads(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_tasks_deal_org FOREIGN KEY (deal_id, organization_id) REFERENCES crm_deals(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_tasks_assignee FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_tasks_completed_by FOREIGN KEY (completed_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_tasks_canceled_by FOREIGN KEY (canceled_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_tasks_created_by FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_tasks_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_tasks_archived_by FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_tasks_context CHECK (organization_id IS NOT NULL OR (lead_id IS NOT NULL AND contact_id IS NULL AND deal_id IS NULL)),
        CONSTRAINT ck_crm_tasks_title CHECK (length(btrim(title)) > 0),
        CONSTRAINT ck_crm_tasks_kind CHECK (kind IN ('GENERAL','FOLLOW_UP')),
        CONSTRAINT ck_crm_tasks_status CHECK (status IN ('OPEN','COMPLETED','CANCELED')),
        CONSTRAINT ck_crm_tasks_priority CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
        CONSTRAINT ck_crm_tasks_lifecycle CHECK (
          (status='OPEN' AND completed_at IS NULL AND canceled_at IS NULL)
          OR (status='COMPLETED' AND completed_at IS NOT NULL AND canceled_at IS NULL)
          OR (status='CANCELED' AND completed_at IS NULL AND canceled_at IS NOT NULL)
        ),
        CONSTRAINT ck_crm_tasks_context_required CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL OR lead_id IS NOT NULL OR deal_id IS NOT NULL)
      )
    `);
    await queryRunner.query("ALTER TABLE crm_tasks ADD CONSTRAINT uq_crm_tasks_id_org UNIQUE (id, organization_id)");
    await queryRunner.query("CREATE INDEX idx_crm_tasks_active_assignee_status_due ON crm_tasks(assigned_to_user_id,status,due_at,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_tasks_active_org_status_due ON crm_tasks(organization_id,status,due_at,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_tasks_active_contact_due ON crm_tasks(contact_id,due_at,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_tasks_active_lead_due ON crm_tasks(lead_id,due_at,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_tasks_active_deal_due ON crm_tasks(deal_id,due_at,id) WHERE archived_at IS NULL");

    await queryRunner.query(`
      CREATE TABLE crm_activities (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid,
        contact_id uuid,
        lead_id uuid,
        deal_id uuid,
        activity_type varchar(16) NOT NULL,
        subject varchar(200) NOT NULL,
        details text,
        occurred_at timestamptz NOT NULL,
        outcome varchar(32),
        actor_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        archived_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_activities_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_activities_contact_org FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_activities_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_activities_lead_org FOREIGN KEY (lead_id, organization_id) REFERENCES crm_leads(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_activities_deal_org FOREIGN KEY (deal_id, organization_id) REFERENCES crm_deals(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_activities_actor FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_activities_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_activities_archived_by FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_activities_context CHECK (organization_id IS NOT NULL OR (lead_id IS NOT NULL AND contact_id IS NULL AND deal_id IS NULL)),
        CONSTRAINT ck_crm_activities_context_required CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL OR lead_id IS NOT NULL OR deal_id IS NOT NULL),
        CONSTRAINT ck_crm_activities_type CHECK (activity_type IN ('CALL','MEETING','DEMO','EMAIL','SMS','WHATSAPP','OTHER')),
        CONSTRAINT ck_crm_activities_subject CHECK (length(btrim(subject)) > 0),
        CONSTRAINT ck_crm_activities_outcome CHECK (
          outcome IS NULL
          OR (activity_type='CALL' AND outcome IN ('CONNECTED','NO_ANSWER','BUSY','CALL_BACK_REQUESTED','NOT_INTERESTED','INTERESTED','INVALID_NUMBER','OTHER'))
          OR (activity_type IN ('MEETING','DEMO') AND outcome IN ('COMPLETED','CANCELED','NO_SHOW','RESCHEDULED','OTHER'))
        )
      )
    `);
    await queryRunner.query("CREATE INDEX idx_crm_activities_active_org_occurred ON crm_activities(organization_id,occurred_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_activities_active_contact_occurred ON crm_activities(contact_id,occurred_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_activities_active_lead_occurred ON crm_activities(lead_id,occurred_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_activities_active_deal_occurred ON crm_activities(deal_id,occurred_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_activities_active_actor_occurred ON crm_activities(actor_user_id,occurred_at DESC,id) WHERE archived_at IS NULL");

    await queryRunner.query(`
      CREATE TABLE crm_notes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id uuid,
        contact_id uuid,
        lead_id uuid,
        deal_id uuid,
        body text NOT NULL,
        author_user_id uuid,
        updated_by_user_id uuid,
        archived_at timestamptz,
        archived_by_user_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_crm_notes_organization FOREIGN KEY (organization_id) REFERENCES crm_organizations(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_notes_contact_org FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_notes_lead FOREIGN KEY (lead_id) REFERENCES crm_leads(id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_notes_lead_org FOREIGN KEY (lead_id, organization_id) REFERENCES crm_leads(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_notes_deal_org FOREIGN KEY (deal_id, organization_id) REFERENCES crm_deals(id, organization_id) ON DELETE RESTRICT,
        CONSTRAINT fk_crm_notes_author FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_notes_updated_by FOREIGN KEY (updated_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT fk_crm_notes_archived_by FOREIGN KEY (archived_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
        CONSTRAINT ck_crm_notes_context CHECK (organization_id IS NOT NULL OR (lead_id IS NOT NULL AND contact_id IS NULL AND deal_id IS NULL)),
        CONSTRAINT ck_crm_notes_context_required CHECK (organization_id IS NOT NULL OR contact_id IS NOT NULL OR lead_id IS NOT NULL OR deal_id IS NOT NULL),
        CONSTRAINT ck_crm_notes_body CHECK (length(btrim(body)) > 0)
      )
    `);
    await queryRunner.query("CREATE INDEX idx_crm_notes_active_org_created ON crm_notes(organization_id,created_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_notes_active_contact_created ON crm_notes(contact_id,created_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_notes_active_lead_created ON crm_notes(lead_id,created_at DESC,id) WHERE archived_at IS NULL");
    await queryRunner.query("CREATE INDEX idx_crm_notes_active_deal_created ON crm_notes(deal_id,created_at DESC,id) WHERE archived_at IS NULL");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP TABLE crm_notes");
    await queryRunner.query("DROP TABLE crm_activities");
    await queryRunner.query("DROP TABLE crm_tasks");
    await queryRunner.query("ALTER TABLE crm_deals DROP CONSTRAINT uq_crm_deals_id_org");
    await queryRunner.query("UPDATE permissions SET description='View Platform CRM organizations, contacts, leads, and deals' WHERE key='crm.read'");
    await queryRunner.query("UPDATE permissions SET description='Create, edit, assign, qualify, convert, manage deals, archive, and restore Platform CRM records' WHERE key='crm.manage'");
  }
}
