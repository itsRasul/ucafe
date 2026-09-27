import { MigrationInterface, QueryRunner } from "typeorm";

export class CrmWorkflowAutomation1790580000000 implements MigrationInterface {
  name = "CrmWorkflowAutomation1790580000000";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE crm_workflows (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        name varchar(120) NOT NULL,
        description varchar(500),
        trigger_type varchar(40) NOT NULL CHECK (trigger_type IN ('LEAD_CREATED','LEAD_QUALIFIED','LEAD_CONVERTED','LEAD_STATUS_CHANGED','DEAL_CREATED','DEAL_STAGE_CHANGED','DEAL_WON','DEAL_LOST','ACTIVITY_CREATED','TASK_COMPLETED','LEAD_SCORE_CHANGED','LEAD_SCORE_CROSSED_THRESHOLD','TASK_OVERDUE','TRIAL_ENDING')),
        trigger_config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(trigger_config)='object'),
        condition_entity_type varchar(20) NOT NULL CHECK (condition_entity_type IN ('ORGANIZATION','LEAD','DEAL')),
        conditions jsonb NOT NULL CHECK (jsonb_typeof(conditions)='object'),
        actions jsonb NOT NULL CHECK (jsonb_typeof(actions)='array' AND jsonb_array_length(actions) BETWEEN 1 AND 10),
        enabled boolean NOT NULL DEFAULT false,
        version integer NOT NULL DEFAULT 1 CHECK (version > 0),
        created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        archived_at timestamptz
      )
    `);
    await queryRunner.query("CREATE INDEX IDX_crm_workflows_match ON crm_workflows(trigger_type,enabled) WHERE archived_at IS NULL");
    await queryRunner.query(`
      CREATE TABLE crm_workflow_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        source_key varchar(300) NOT NULL UNIQUE,
        event_type varchar(40) NOT NULL CHECK (event_type IN ('LEAD_CREATED','LEAD_QUALIFIED','LEAD_CONVERTED','LEAD_STATUS_CHANGED','DEAL_CREATED','DEAL_STAGE_CHANGED','DEAL_WON','DEAL_LOST','ACTIVITY_CREATED','TASK_COMPLETED','LEAD_SCORE_CHANGED','TASK_OVERDUE','TRIAL_ENDING')),
        subject_type varchar(20) NOT NULL CHECK (subject_type IN ('ORGANIZATION','LEAD','DEAL','ACTIVITY','TASK')),
        subject_id uuid NOT NULL,
        record_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(record_context)='object'),
        event_context jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(event_context)='object'),
        target_workflow_id uuid REFERENCES crm_workflows(id) ON DELETE RESTRICT,
        correlation_id uuid NOT NULL,
        causation_execution_id uuid,
        automation_depth smallint NOT NULL DEFAULT 0 CHECK (automation_depth BETWEEN 0 AND 255),
        status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','PROCESSED','FAILED','LOOP_BLOCKED')),
        attempt smallint NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        claimed_at timestamptz,
        processed_at timestamptz,
        error_code varchar(60),
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query("CREATE INDEX IDX_crm_workflow_events_ready ON crm_workflow_events(status,next_attempt_at,created_at) WHERE status IN ('PENDING','PROCESSING')");
    await queryRunner.query("CREATE INDEX IDX_crm_workflow_events_correlation ON crm_workflow_events(correlation_id,created_at)");
    await queryRunner.query(`
      CREATE TABLE crm_workflow_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_id uuid NOT NULL REFERENCES crm_workflows(id) ON DELETE RESTRICT,
        event_id uuid NOT NULL REFERENCES crm_workflow_events(id) ON DELETE RESTRICT,
        workflow_version integer NOT NULL CHECK (workflow_version > 0),
        trigger_type varchar(40) NOT NULL,
        record_type varchar(20) NOT NULL CHECK (record_type IN ('ORGANIZATION','LEAD','DEAL')),
        record_id uuid NOT NULL,
        status varchar(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','RETRYING','SUCCEEDED','FAILED')),
        workflow_snapshot jsonb NOT NULL CHECK (jsonb_typeof(workflow_snapshot)='object'),
        correlation_id uuid NOT NULL,
        automation_depth smallint NOT NULL CHECK (automation_depth BETWEEN 0 AND 255),
        error_code varchar(60),
        error_message varchar(250),
        started_at timestamptz NOT NULL DEFAULT now(),
        completed_at timestamptz,
        failed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE (workflow_id,event_id)
      )
    `);
    await queryRunner.query("CREATE INDEX IDX_crm_workflow_executions_history ON crm_workflow_executions(workflow_id,created_at DESC,id DESC)");
    await queryRunner.query("CREATE INDEX IDX_crm_workflow_executions_status ON crm_workflow_executions(status,created_at DESC)");
    await queryRunner.query(`
      CREATE TABLE crm_workflow_action_executions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        workflow_execution_id uuid NOT NULL REFERENCES crm_workflow_executions(id) ON DELETE RESTRICT,
        action_index smallint NOT NULL CHECK (action_index BETWEEN 0 AND 9),
        action_type varchar(40) NOT NULL CHECK (action_type IN ('CREATE_TASK','ADD_TAG','REMOVE_TAG','ASSIGN_LEAD_OWNER','ASSIGN_DEAL_OWNER')),
        config jsonb NOT NULL CHECK (jsonb_typeof(config)='object'),
        status varchar(20) NOT NULL CHECK (status IN ('PENDING','RUNNING','RETRYING','SUCCEEDED','FAILED')),
        attempt smallint NOT NULL DEFAULT 0 CHECK (attempt >= 0),
        manual_retry_count smallint NOT NULL DEFAULT 0 CHECK (manual_retry_count BETWEEN 0 AND 3),
        next_attempt_at timestamptz NOT NULL DEFAULT now(),
        started_at timestamptz,
        completed_at timestamptz,
        result_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(result_metadata)='object'),
        error_code varchar(60),
        error_message varchar(250),
        UNIQUE (workflow_execution_id,action_index)
      )
    `);
    await queryRunner.query("CREATE INDEX IDX_crm_workflow_actions_ready ON crm_workflow_action_executions(status,next_attempt_at,workflow_execution_id) WHERE status IN ('PENDING','RETRYING')");
    await queryRunner.query("ALTER TABLE crm_workflow_events ADD CONSTRAINT FK_crm_workflow_events_causation FOREIGN KEY (causation_execution_id) REFERENCES crm_workflow_executions(id) ON DELETE SET NULL");
    await queryRunner.query("ALTER TABLE crm_tasks ADD COLUMN automation_action_execution_id uuid");
    await queryRunner.query("ALTER TABLE crm_tasks ADD CONSTRAINT FK_crm_tasks_automation_action FOREIGN KEY (automation_action_execution_id) REFERENCES crm_workflow_action_executions(id) ON DELETE SET NULL");
    await queryRunner.query("CREATE UNIQUE INDEX UQ_crm_tasks_automation_action ON crm_tasks(automation_action_execution_id) WHERE automation_action_execution_id IS NOT NULL");
    await queryRunner.query("CREATE INDEX IDX_crm_tasks_overdue ON crm_tasks(due_at) WHERE status='OPEN' AND archived_at IS NULL AND due_at IS NOT NULL");
    await queryRunner.query("CREATE INDEX IDX_subscriptions_trial_ending ON subscriptions(trial_ends_at) WHERE status='TRIALING' AND trial_ends_at IS NOT NULL");
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query("DROP INDEX IDX_subscriptions_trial_ending");
    await queryRunner.query("DROP INDEX IDX_crm_tasks_overdue");
    await queryRunner.query("DROP INDEX UQ_crm_tasks_automation_action");
    await queryRunner.query("ALTER TABLE crm_tasks DROP CONSTRAINT FK_crm_tasks_automation_action");
    await queryRunner.query("ALTER TABLE crm_tasks DROP COLUMN automation_action_execution_id");
    await queryRunner.query("ALTER TABLE crm_workflow_events DROP CONSTRAINT FK_crm_workflow_events_causation");
    await queryRunner.query("DROP INDEX IDX_crm_workflow_actions_ready");
    await queryRunner.query("DROP TABLE crm_workflow_action_executions");
    await queryRunner.query("DROP INDEX IDX_crm_workflow_executions_status");
    await queryRunner.query("DROP INDEX IDX_crm_workflow_executions_history");
    await queryRunner.query("DROP TABLE crm_workflow_executions");
    await queryRunner.query("DROP INDEX IDX_crm_workflow_events_correlation");
    await queryRunner.query("DROP INDEX IDX_crm_workflow_events_ready");
    await queryRunner.query("DROP TABLE crm_workflow_events");
    await queryRunner.query("DROP INDEX IDX_crm_workflows_match");
    await queryRunner.query("DROP TABLE crm_workflows");
  }
}
