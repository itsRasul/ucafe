import { MigrationInterface, QueryRunner } from "typeorm";

export class TenantCrmAutomation1790660000000 implements MigrationInterface {
  name = "TenantCrmAutomation1790660000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE domain_event_outbox ADD CONSTRAINT UQ_domain_event_outbox_tenant_id UNIQUE(coffee_shop_id,id)`);
    await queryRunner.query(`ALTER TABLE domain_event_outbox
      ADD COLUMN automation_dispatch_status varchar(12) NOT NULL DEFAULT 'PENDING',
      ADD COLUMN automation_dispatch_attempts smallint NOT NULL DEFAULT 0,
      ADD COLUMN automation_dispatch_next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN automation_dispatch_claimed_at timestamptz,
      ADD COLUMN automation_dispatched_at timestamptz,
      ADD COLUMN automation_dispatch_error_code varchar(50),
      ADD COLUMN correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
      ADD COLUMN causation_execution_id uuid,
      ADD COLUMN automation_depth smallint NOT NULL DEFAULT 0,
      ADD CONSTRAINT CK_domain_event_automation_dispatch_status CHECK (automation_dispatch_status IN ('PENDING','PROCESSING','PROCESSED','FAILED','LOOP_BLOCKED')),
      ADD CONSTRAINT CK_domain_event_automation_dispatch_attempts CHECK (automation_dispatch_attempts BETWEEN 0 AND 3),
      ADD CONSTRAINT CK_domain_event_automation_depth CHECK (automation_depth BETWEEN 0 AND 5)`);
    await queryRunner.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PROCESSED',automation_dispatched_at=created_at`);
    await queryRunner.query(`CREATE INDEX IDX_domain_event_outbox_automation_dispatch
      ON domain_event_outbox(automation_dispatch_status,automation_dispatch_next_attempt_at,created_at,id)
      WHERE event_type IN ('tenant.order.delivered','tenant.crm.feedback.created','tenant.crm.feedback.resolved')
        AND automation_dispatch_status IN ('PENDING','PROCESSING')`);
    await queryRunner.query(`CREATE INDEX IDX_domain_event_outbox_automation_stale ON domain_event_outbox(automation_dispatch_claimed_at)
      WHERE automation_dispatch_status='PROCESSING'`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_automations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL REFERENCES coffee_shops(id) ON DELETE CASCADE,
        name varchar(120) NOT NULL CHECK (name=btrim(name) AND char_length(name) BETWEEN 1 AND 120),
        description varchar(500),
        status varchar(12) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','PAUSED','ARCHIVED')),
        trigger_type varchar(32) NOT NULL CHECK (trigger_type IN ('ORDER_DELIVERED','FEEDBACK_CREATED','FEEDBACK_RESOLVED','CLIENT_LAPSED','CLIENT_BIRTHDAY')),
        trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_config)='object'),
        conditions jsonb CHECK (conditions IS NULL OR jsonb_typeof(conditions)='object'),
        actions jsonb NOT NULL CHECK (jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by_user_id uuid NOT NULL,
        activated_at timestamptz,
        time_scanned_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_automations_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT FK_tenant_crm_automations_creator FOREIGN KEY(coffee_shop_id,created_by_user_id)
          REFERENCES coffee_shop_memberships(coffee_shop_id,user_id) ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automations_dispatch ON tenant_crm_automations(coffee_shop_id,status,trigger_type,id)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automations_time_scan ON tenant_crm_automations(time_scanned_at ASC NULLS FIRST,id)
      WHERE status='ACTIVE' AND trigger_type IN ('CLIENT_LAPSED','CLIENT_BIRTHDAY')`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_automation_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        automation_id uuid NOT NULL,
        source_event_id uuid,
        client_id uuid NOT NULL,
        trigger_type varchar(32) NOT NULL CHECK (trigger_type IN ('ORDER_DELIVERED','FEEDBACK_CREATED','FEEDBACK_RESOLVED','CLIENT_LAPSED','CLIENT_BIRTHDAY')),
        subject_type varchar(24) NOT NULL CHECK (subject_type IN ('ORDER','FEEDBACK','CLIENT')),
        subject_id uuid NOT NULL,
        occurrence_key varchar(240) NOT NULL,
        automation_version integer NOT NULL CHECK (automation_version > 0),
        definition_snapshot jsonb NOT NULL CHECK (jsonb_typeof(definition_snapshot)='object'),
        trigger_data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_data)='object'),
        causation_execution_id uuid,
        status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','SKIPPED','FAILED','LOOP_BLOCKED')),
        attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        started_at timestamptz,
        conditions_evaluated_at timestamptz,
        completed_at timestamptz,
        failed_at timestamptz,
        error_code varchar(50),
        error_message varchar(240),
        correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
        automation_depth smallint NOT NULL DEFAULT 0 CHECK (automation_depth BETWEEN 0 AND 5),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_automation_executions_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_automation_execution_occurrence UNIQUE(coffee_shop_id,automation_id,occurrence_key),
        CONSTRAINT FK_tenant_crm_automation_execution_automation FOREIGN KEY(coffee_shop_id,automation_id)
          REFERENCES tenant_crm_automations(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_automation_execution_client FOREIGN KEY(coffee_shop_id,client_id)
          REFERENCES clients(coffee_shop_id,id) ON DELETE CASCADE,
        CONSTRAINT FK_tenant_crm_automation_execution_event FOREIGN KEY(coffee_shop_id,source_event_id)
          REFERENCES domain_event_outbox(coffee_shop_id,id) ON DELETE RESTRICT,
        CONSTRAINT FK_tenant_crm_automation_execution_causation FOREIGN KEY(coffee_shop_id,causation_execution_id)
          REFERENCES tenant_crm_automation_executions(coffee_shop_id,id) ON DELETE SET NULL (causation_execution_id)
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_executions_history
      ON tenant_crm_automation_executions(coffee_shop_id,automation_id,created_at DESC,id DESC)`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_executions_dispatch
      ON tenant_crm_automation_executions(status,next_attempt_at,created_at,id)
      WHERE status IN ('PENDING','PROCESSING')`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_executions_stale ON tenant_crm_automation_executions(claimed_at)
      WHERE status='PROCESSING' AND conditions_evaluated_at IS NULL`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_executions_causation
      ON tenant_crm_automation_executions(coffee_shop_id,causation_execution_id) WHERE causation_execution_id IS NOT NULL`);
    await queryRunner.query(`ALTER TABLE domain_event_outbox ADD CONSTRAINT FK_domain_event_automation_causation
      FOREIGN KEY(coffee_shop_id,causation_execution_id) REFERENCES tenant_crm_automation_executions(coffee_shop_id,id)
      ON DELETE SET NULL (causation_execution_id)`);

    await queryRunner.query(`
      CREATE TABLE tenant_crm_automation_actions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        coffee_shop_id uuid NOT NULL,
        automation_execution_id uuid NOT NULL,
        action_index smallint NOT NULL CHECK (action_index BETWEEN 0 AND 9),
        action_type varchar(24) NOT NULL CHECK (action_type IN ('ADD_TAG','REMOVE_TAG','CREATE_REMINDER','ADD_NOTE')),
        config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
        status varchar(12) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','SUCCEEDED','FAILED','SKIPPED')),
        attempts smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        started_at timestamptz,
        completed_at timestamptz,
        error_code varchar(50),
        error_message varchar(240),
        result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_metadata)='object'),
        created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT UQ_tenant_crm_automation_actions_tenant_id UNIQUE(coffee_shop_id,id),
        CONSTRAINT UQ_tenant_crm_automation_action_order UNIQUE(coffee_shop_id,automation_execution_id,action_index),
        CONSTRAINT FK_tenant_crm_automation_action_execution FOREIGN KEY(coffee_shop_id,automation_execution_id)
          REFERENCES tenant_crm_automation_executions(coffee_shop_id,id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_actions_dispatch
      ON tenant_crm_automation_actions(status,next_attempt_at,created_at,id) WHERE status IN ('PENDING','PROCESSING')`);
    await queryRunner.query(`CREATE INDEX IDX_tenant_crm_automation_actions_stale ON tenant_crm_automation_actions(claimed_at)
      WHERE status='PROCESSING'`);

    await queryRunner.query(`ALTER TABLE tenant_crm_client_tags
      ALTER COLUMN created_by_user_id DROP NOT NULL,
      ADD COLUMN automation_action_execution_id uuid,
      ADD CONSTRAINT CK_tenant_crm_client_tags_actor CHECK ((created_by_user_id IS NOT NULL) <> (automation_action_execution_id IS NOT NULL)),
      ADD CONSTRAINT FK_tenant_crm_client_tags_automation FOREIGN KEY(coffee_shop_id,automation_action_execution_id)
        REFERENCES tenant_crm_automation_actions(coffee_shop_id,id) ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_client_tags_automation_action
      ON tenant_crm_client_tags(coffee_shop_id,automation_action_execution_id) WHERE automation_action_execution_id IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE tenant_crm_client_notes
      ALTER COLUMN created_by_user_id DROP NOT NULL,
      ADD COLUMN automation_action_execution_id uuid,
      ADD CONSTRAINT CK_tenant_crm_client_notes_actor CHECK ((created_by_user_id IS NOT NULL) <> (automation_action_execution_id IS NOT NULL)),
      ADD CONSTRAINT FK_tenant_crm_client_notes_automation FOREIGN KEY(coffee_shop_id,automation_action_execution_id)
        REFERENCES tenant_crm_automation_actions(coffee_shop_id,id) ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_client_notes_automation_action
      ON tenant_crm_client_notes(coffee_shop_id,automation_action_execution_id) WHERE automation_action_execution_id IS NOT NULL`);

    await queryRunner.query(`ALTER TABLE tenant_crm_reminders
      ALTER COLUMN created_by_user_id DROP NOT NULL,
      ADD COLUMN automation_action_execution_id uuid,
      ADD CONSTRAINT CK_tenant_crm_reminders_actor CHECK ((created_by_user_id IS NOT NULL) <> (automation_action_execution_id IS NOT NULL)),
      ADD CONSTRAINT FK_tenant_crm_reminders_automation FOREIGN KEY(coffee_shop_id,automation_action_execution_id)
        REFERENCES tenant_crm_automation_actions(coffee_shop_id,id) ON DELETE RESTRICT`);
    await queryRunner.query(`CREATE UNIQUE INDEX UQ_tenant_crm_reminders_automation_action
      ON tenant_crm_reminders(coffee_shop_id,automation_action_execution_id) WHERE automation_action_execution_id IS NOT NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX UQ_tenant_crm_reminders_automation_action`);
    await queryRunner.query(`ALTER TABLE tenant_crm_reminders DROP CONSTRAINT FK_tenant_crm_reminders_automation,
      DROP CONSTRAINT CK_tenant_crm_reminders_actor, DROP COLUMN automation_action_execution_id, ALTER COLUMN created_by_user_id SET NOT NULL`);
    await queryRunner.query(`DROP INDEX UQ_tenant_crm_client_notes_automation_action`);
    await queryRunner.query(`ALTER TABLE tenant_crm_client_notes DROP CONSTRAINT FK_tenant_crm_client_notes_automation,
      DROP CONSTRAINT CK_tenant_crm_client_notes_actor, DROP COLUMN automation_action_execution_id, ALTER COLUMN created_by_user_id SET NOT NULL`);
    await queryRunner.query(`DROP INDEX UQ_tenant_crm_client_tags_automation_action`);
    await queryRunner.query(`ALTER TABLE tenant_crm_client_tags DROP CONSTRAINT FK_tenant_crm_client_tags_automation,
      DROP CONSTRAINT CK_tenant_crm_client_tags_actor, DROP COLUMN automation_action_execution_id, ALTER COLUMN created_by_user_id SET NOT NULL`);
    await queryRunner.query(`DROP INDEX IDX_tenant_crm_automation_actions_stale`);
    await queryRunner.query(`DROP TABLE tenant_crm_automation_actions`);
    await queryRunner.query(`ALTER TABLE domain_event_outbox DROP CONSTRAINT FK_domain_event_automation_causation`);
    await queryRunner.query(`DROP INDEX IDX_tenant_crm_automation_executions_stale`);
    await queryRunner.query(`DROP INDEX IDX_tenant_crm_automation_executions_causation`);
    await queryRunner.query(`DROP TABLE tenant_crm_automation_executions`);
    await queryRunner.query(`DROP INDEX IDX_tenant_crm_automations_time_scan`);
    await queryRunner.query(`DROP TABLE tenant_crm_automations`);
    await queryRunner.query(`DROP INDEX IDX_domain_event_outbox_automation_stale`);
    await queryRunner.query(`DROP INDEX IDX_domain_event_outbox_automation_dispatch`);
    await queryRunner.query(`ALTER TABLE domain_event_outbox
      DROP CONSTRAINT CK_domain_event_automation_dispatch_status,
      DROP CONSTRAINT CK_domain_event_automation_dispatch_attempts,
      DROP CONSTRAINT CK_domain_event_automation_depth,
      DROP COLUMN automation_dispatch_status,
      DROP COLUMN automation_dispatch_attempts,
      DROP COLUMN automation_dispatch_next_attempt_at,
      DROP COLUMN automation_dispatch_claimed_at,
      DROP COLUMN automation_dispatched_at,
      DROP COLUMN automation_dispatch_error_code,
      DROP COLUMN correlation_id,
      DROP COLUMN causation_execution_id,
      DROP COLUMN automation_depth,
      DROP CONSTRAINT UQ_domain_event_outbox_tenant_id`);
  }
}
