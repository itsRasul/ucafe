import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmWorkflowService } from "./crm-workflow.service";
import { CrmWorkflowEventService } from "./crm-workflow-event.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmDealService } from "./crm-deal.service";
import { CrmTaskService } from "./crm-task.service";
import { CrmMetadataService } from "./crm-metadata.service";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CrmTaskKind, CrmTaskPriority } from "./entities/crm-task.entity";
import { CRM_WORKFLOW_MAX_ATTEMPTS, CrmWorkflowActionType, CrmWorkflowEventType, CrmWorkflowRecordType, isTransientWorkflowError, triggerMatches, workflowLoopBlocked, workflowRetryDelayMs, workflowSafeError } from "./crm-workflow.util";

type Row = Record<string, any>;
type EventRow = { id: string; eventType: CrmWorkflowEventType; subjectType: string; subjectId: string; recordContext: Record<string, string | null>; eventContext: Record<string, unknown>; targetWorkflowId: string | null; correlationId: string; automationDepth: number; attempt: number; createdAt: Date };
type ActionRow = { id: string; workflowExecutionId: string; actionIndex: number; actionType: CrmWorkflowActionType; config: Record<string, unknown>; attempt: number; recordType: CrmWorkflowRecordType; recordId: string; workflowSnapshot: Row; correlationId: string; automationDepth: number; recordContext: Record<string, string | null>; triggeredAt: Date };

@Injectable()
export class CrmWorkflowRuntimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CrmWorkflowRuntimeService.name);
  private timer?: NodeJS.Timeout;
  private startup?: NodeJS.Timeout;
  private running = false;
  private lastScheduleSweep = 0;

  constructor(
    private readonly dataSource: DataSource,
    private readonly workflows: CrmWorkflowService,
    private readonly workflowEvents: CrmWorkflowEventService,
    private readonly leads: CrmLeadService,
    private readonly deals: CrmDealService,
    private readonly tasks: CrmTaskService,
    private readonly metadata: CrmMetadataService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.process(), 5_000);
    this.timer.unref();
    this.startup = setTimeout(() => void this.process(), 1_000);
    this.startup.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    if (this.startup) clearTimeout(this.startup);
  }

  async process() {
    if (this.running) return;
    this.running = true;
    try {
      await this.scanScheduledEvents();
      await this.recoverStaleWork();
      for (let i = 0; i < 25; i++) {
        const event = await this.claimEvent();
        if (!event) break;
        try { await this.dispatchEvent(event); }
        catch (error) { await this.failEvent(event, error); }
      }
      for (let i = 0; i < 50; i++) {
        const action = await this.claimAction();
        if (!action) break;
        try { await this.executeAction(action); }
        catch (error) { await this.failAction(action, error); }
      }
    } catch (error) {
      this.logger.error(`CRM workflow poll failed (${workflowSafeError(error).code})`);
    } finally { this.running = false; }
  }

  private async scanScheduledEvents(now = new Date()) {
    if (Date.now() - this.lastScheduleSweep < 60_000) return;
    this.lastScheduleSweep = Date.now();
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.query<Row[]>("SELECT pg_try_advisory_xact_lock(hashtext('crm-workflow-scheduler')) AS locked");
      if (!locked[0]?.locked) return;
      const definitions = await manager.query<Row[]>(`SELECT id,trigger_type AS "triggerType",trigger_config AS "triggerConfig",condition_entity_type AS "conditionEntityType",conditions,actions,name,description,enabled
        FROM crm_workflows WHERE enabled=true AND archived_at IS NULL AND trigger_type IN ('TRIAL_ENDING','TASK_OVERDUE') ORDER BY id`);
      for (const workflow of definitions) if (workflow.triggerType === "TRIAL_ENDING") await this.enqueueTrialEnding(manager, workflow, now);
      if (definitions.some((workflow) => workflow.triggerType === "TASK_OVERDUE")) await this.enqueueOverdueTasks(manager, now);
    });
  }

  private async enqueueTrialEnding(manager: EntityManager, workflow: Row, now: Date) {
    const days = Number(workflow.triggerConfig?.daysBefore);
    if (!Number.isInteger(days) || days < 1 || days > 30) return;
    const rows = await manager.query<Row[]>(`SELECT o.id AS "organizationId",s.id AS "subscriptionId",s.trial_ends_at AS "trialEndsAt",
        floor(extract(epoch FROM s.trial_ends_at)*1000)::bigint AS "trialEndKey"
      FROM crm_organizations o JOIN subscriptions s ON s.coffee_shop_id=o.coffee_shop_id
      JOIN coffee_shops cs ON cs.id=s.coffee_shop_id
      WHERE o.archived_at IS NULL AND cs.deleted_at IS NULL AND s.status='TRIALING' AND s.trial_ends_at>$1
        AND s.trial_ends_at<=$1+($2 * interval '1 day')
        AND NOT EXISTS (SELECT 1 FROM crm_workflow_events e WHERE e.source_key='trial-ending:'||$3||':'||s.id||':'||floor(extract(epoch FROM s.trial_ends_at)*1000)::bigint)
      ORDER BY s.trial_ends_at,s.id LIMIT 1000`, [now, days, workflow.id]);
    for (const row of rows) await this.workflowEvents.record(manager, {
      eventType: "TRIAL_ENDING", subjectType: "ORGANIZATION", subjectId: row.organizationId as string, targetWorkflowId: workflow.id as string,
      sourceKey: `trial-ending:${workflow.id}:${row.subscriptionId}:${row.trialEndKey}`,
      eventContext: { subscriptionId: row.subscriptionId, trialEndsAt: new Date(row.trialEndsAt).toISOString(), daysBefore: days },
    });
  }

  private async enqueueOverdueTasks(manager: EntityManager, now: Date) {
    const rows = await manager.query<Row[]>(`SELECT t.id,floor(extract(epoch FROM t.due_at)*1000)::bigint AS "dueKey"
      FROM crm_tasks t WHERE t.status='OPEN' AND t.archived_at IS NULL AND t.due_at<=$1
        AND NOT EXISTS (SELECT 1 FROM crm_workflow_events e WHERE e.source_key='task-overdue:'||t.id||':'||floor(extract(epoch FROM t.due_at)*1000)::bigint)
      ORDER BY t.due_at,t.id LIMIT 1000`, [now]);
    for (const row of rows) await this.workflowEvents.record(manager, { eventType: "TASK_OVERDUE", subjectType: "TASK", subjectId: row.id as string, sourceKey: `task-overdue:${row.id}:${row.dueKey}`, eventContext: { dueAt: new Date(Number(row.dueKey)).toISOString() } });
  }

  private async recoverStaleWork() {
    await this.dataSource.transaction(async (manager) => {
      const events = await manager.query<Row[]>(`WITH stale AS (
        SELECT id,attempt FROM crm_workflow_events WHERE status='PROCESSING' AND claimed_at<now()-interval '5 minutes' FOR UPDATE SKIP LOCKED LIMIT 100
      ) UPDATE crm_workflow_events e SET status=CASE WHEN stale.attempt>=${CRM_WORKFLOW_MAX_ATTEMPTS} THEN 'FAILED' ELSE 'PENDING' END,
        next_attempt_at=now(),claimed_at=NULL,error_code=CASE WHEN stale.attempt>=${CRM_WORKFLOW_MAX_ATTEMPTS} THEN 'EVENT_RETRIES_EXHAUSTED' ELSE NULL END
        FROM stale WHERE e.id=stale.id RETURNING e.id`);
      if (events.length) this.logger.warn(`Recovered ${events.length} stale CRM workflow events`);
      const actions = await manager.query<Row[]>(`WITH stale AS (
        SELECT id,workflow_execution_id,attempt FROM crm_workflow_action_executions
        WHERE status='RUNNING' AND started_at<now()-interval '5 minutes' FOR UPDATE SKIP LOCKED LIMIT 100
      ) UPDATE crm_workflow_action_executions a SET status=CASE WHEN stale.attempt>=${CRM_WORKFLOW_MAX_ATTEMPTS} THEN 'FAILED' ELSE 'RETRYING' END,
        next_attempt_at=now(),error_code=CASE WHEN stale.attempt>=${CRM_WORKFLOW_MAX_ATTEMPTS} THEN 'ACTION_RETRIES_EXHAUSTED' ELSE NULL END,
        error_message=CASE WHEN stale.attempt>=${CRM_WORKFLOW_MAX_ATTEMPTS} THEN 'The action worker stopped before completion.' ELSE NULL END
        FROM stale WHERE a.id=stale.id RETURNING a.workflow_execution_id,a.status,a.error_code,a.error_message`);
      const failedIds = [...new Set(actions.filter((row) => row.status === "FAILED").map((row) => row.workflow_execution_id as string))];
      for (const id of failedIds) await manager.query("UPDATE crm_workflow_executions SET status='FAILED',error_code='ACTION_RETRIES_EXHAUSTED',error_message='An action worker stopped before completion.',failed_at=now() WHERE id=$1", [id]);
      const retryIds = [...new Set(actions.filter((row) => row.status === "RETRYING").map((row) => row.workflow_execution_id as string))];
      for (const id of retryIds) await manager.query("UPDATE crm_workflow_executions SET status='RETRYING' WHERE id=$1 AND status<>'FAILED'", [id]);
    });
  }

  private async claimEvent(): Promise<EventRow | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Row[]>(`SELECT id,event_type AS "eventType",subject_type AS "subjectType",subject_id AS "subjectId",record_context AS "recordContext",
        event_context AS "eventContext",target_workflow_id AS "targetWorkflowId",correlation_id AS "correlationId",automation_depth AS "automationDepth",attempt,created_at AS "createdAt"
        FROM crm_workflow_events WHERE status='PENDING' AND next_attempt_at<=now() ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      await manager.query("UPDATE crm_workflow_events SET status='PROCESSING',attempt=attempt+1,claimed_at=now() WHERE id=$1", [rows[0].id]);
      return { ...rows[0], attempt: Number(rows[0].attempt) + 1 } as EventRow;
    });
  }

  private async dispatchEvent(event: EventRow) {
    await this.dataSource.transaction(async (manager) => {
      const currentRows = await manager.query<Row[]>("SELECT status FROM crm_workflow_events WHERE id=$1 FOR UPDATE", [event.id]);
      if (currentRows[0]?.status !== "PROCESSING") return;
      if (workflowLoopBlocked(Number(event.automationDepth))) {
        await manager.query("UPDATE crm_workflow_events SET status='LOOP_BLOCKED',processed_at=now(),error_code='MAX_AUTOMATION_DEPTH' WHERE id=$1", [event.id]);
        return;
      }
      const candidates = await this.workflowCandidates(manager, event);
      for (const workflow of candidates) {
        const triggerType = workflow.triggerType as Parameters<typeof triggerMatches>[0];
        if (!triggerMatches(triggerType, workflow.triggerConfig ?? {}, event.eventType, event.eventContext ?? {})) continue;
        const recordType = workflow.conditionEntityType as CrmWorkflowRecordType;
        const recordId = event.recordContext?.[`${recordType.toLowerCase()}Id`];
        if (!recordId) continue;
        const snapshot = this.workflowSnapshot(workflow);
        try {
          await this.workflows.validateDefinition(manager, this.definitionFromWorkflow(workflow));
          if (workflow.triggerType === "TRIAL_ENDING" && !await this.trialIsCurrent(manager, event)) continue;
          if (!await this.conditionsMatch(manager, recordType, recordId, workflow.conditions)) continue;
          await this.insertExecution(manager, workflow, event, recordType, recordId, snapshot, false);
        } catch {
          await this.insertExecution(manager, workflow, event, recordType, recordId, snapshot, true);
        }
      }
      await manager.query("UPDATE crm_workflow_events SET status='PROCESSED',processed_at=now(),claimed_at=NULL WHERE id=$1", [event.id]);
    });
  }

  private async workflowCandidates(manager: EntityManager, event: EventRow) {
    const types = event.eventType === "LEAD_SCORE_CHANGED" ? ["LEAD_SCORE_CHANGED", "LEAD_SCORE_CROSSED_THRESHOLD"] : [event.eventType];
    const targeted = event.targetWorkflowId ? "AND id=$2" : "";
    const values = event.targetWorkflowId ? [types, event.targetWorkflowId] : [types];
    return manager.query<Row[]>(`SELECT id,name,description,trigger_type AS "triggerType",trigger_config AS "triggerConfig",condition_entity_type AS "conditionEntityType",
      conditions,actions,enabled,version FROM crm_workflows WHERE enabled=true AND archived_at IS NULL AND trigger_type=ANY($1::varchar[]) ${targeted} ORDER BY id FOR SHARE`, values);
  }

  private async conditionsMatch(manager: EntityManager, type: CrmWorkflowRecordType, id: string, criteria: Record<string, unknown>) {
    return this.workflows.conditionsMatch(manager, type, id, criteria);
  }

  private async trialIsCurrent(manager: EntityManager, event: EventRow) {
    const { subscriptionId, trialEndsAt } = event.eventContext;
    if (typeof subscriptionId !== "string" || typeof trialEndsAt !== "string") return false;
    const rows = await manager.query<Row[]>(`SELECT 1 FROM subscriptions s JOIN crm_organizations o ON o.coffee_shop_id=s.coffee_shop_id
      WHERE s.id=$1 AND o.id=$2 AND s.status='TRIALING'
        AND floor(extract(epoch FROM s.trial_ends_at)*1000)::bigint=floor(extract(epoch FROM $3::timestamptz)*1000)::bigint
        AND s.trial_ends_at>now() AND o.archived_at IS NULL`, [subscriptionId, event.subjectId, trialEndsAt]);
    return Boolean(rows[0]);
  }

  private async insertExecution(manager: EntityManager, workflow: Row, event: EventRow, recordType: CrmWorkflowRecordType, recordId: string, snapshot: Row, invalid: boolean) {
    const rows = await manager.query<Row[]>(`INSERT INTO crm_workflow_executions(workflow_id,event_id,workflow_version,trigger_type,record_type,record_id,status,workflow_snapshot,
      correlation_id,automation_depth,error_code,error_message,completed_at,failed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$13) ON CONFLICT(workflow_id,event_id) DO NOTHING RETURNING id`, [
      workflow.id, event.id, workflow.version, workflow.triggerType, recordType, recordId, invalid ? "FAILED" : "PENDING", JSON.stringify(snapshot), event.correlationId,
      event.automationDepth, invalid ? "INVALID_CONFIGURATION" : null, invalid ? "Workflow configuration is no longer valid. Review fields, Tags, and assignees." : null, invalid ? new Date() : null,
    ]);
    if (!rows[0] || invalid) return;
    const actions: Array<{ type: string; config: Record<string, unknown> }> = snapshot.actions;
    for (let index = 0; index < actions.length; index++) await manager.query(`INSERT INTO crm_workflow_action_executions(workflow_execution_id,action_index,action_type,config,status)
      VALUES($1,$2,$3,$4::jsonb,'PENDING')`, [rows[0].id, index, actions[index]!.type, JSON.stringify(actions[index]!.config)]);
  }

  private async claimAction(): Promise<ActionRow | null> {
    return this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Row[]>(`SELECT a.id,a.workflow_execution_id AS "workflowExecutionId",a.action_index AS "actionIndex",a.action_type AS "actionType",a.config,a.attempt,
        e.record_type AS "recordType",e.record_id AS "recordId",e.workflow_snapshot AS "workflowSnapshot",e.correlation_id AS "correlationId",e.automation_depth AS "automationDepth",
        ev.record_context AS "recordContext",ev.created_at AS "triggeredAt"
        FROM crm_workflow_action_executions a JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id JOIN crm_workflow_events ev ON ev.id=e.event_id
        WHERE a.status IN ('PENDING','RETRYING') AND a.next_attempt_at<=now() AND e.status IN ('PENDING','RUNNING','RETRYING')
          AND NOT EXISTS (SELECT 1 FROM crm_workflow_action_executions previous WHERE previous.workflow_execution_id=a.workflow_execution_id AND previous.action_index<a.action_index AND previous.status<>'SUCCEEDED')
        ORDER BY e.created_at,e.id,a.action_index FOR UPDATE OF a,e SKIP LOCKED LIMIT 1`);
      if (!rows[0]) return null;
      await manager.query("UPDATE crm_workflow_action_executions SET status='RUNNING',attempt=attempt+1,started_at=now() WHERE id=$1", [rows[0].id]);
      await manager.query("UPDATE crm_workflow_executions SET status='RUNNING' WHERE id=$1", [rows[0].workflowExecutionId]);
      return { ...rows[0], attempt: Number(rows[0].attempt) + 1 } as ActionRow;
    });
  }

  private async executeAction(action: ActionRow) {
    await this.dataSource.transaction(async (manager) => {
      const locked = await manager.query<Row[]>("SELECT status FROM crm_workflow_action_executions WHERE id=$1 FOR UPDATE", [action.id]);
      if (locked[0]?.status !== "RUNNING") return;
      await manager.query(`SELECT set_config('ucafe.crm_automation_execution_id',$1,true),set_config('ucafe.crm_automation_correlation_id',$2,true),set_config('ucafe.crm_automation_depth',$3,true)`,
        [action.workflowExecutionId, action.correlationId, String(Number(action.automationDepth) + 1)]);
      const result = await this.applyAction(manager, action);
      await manager.query("UPDATE crm_workflow_action_executions SET status='SUCCEEDED',completed_at=now(),result_metadata=$2::jsonb,error_code=NULL,error_message=NULL WHERE id=$1", [action.id, JSON.stringify(result)]);
      const remaining = await manager.query<Row[]>("SELECT count(*)::int AS total FROM crm_workflow_action_executions WHERE workflow_execution_id=$1 AND status<>'SUCCEEDED'", [action.workflowExecutionId]);
      if (Number(remaining[0]?.total ?? 0) === 0) await manager.query("UPDATE crm_workflow_executions SET status='SUCCEEDED',completed_at=now(),failed_at=NULL,error_code=NULL,error_message=NULL WHERE id=$1", [action.workflowExecutionId]);
      else await manager.query("UPDATE crm_workflow_executions SET status='PENDING' WHERE id=$1", [action.workflowExecutionId]);
    });
  }

  private async applyAction(manager: EntityManager, action: ActionRow): Promise<Record<string, unknown>> {
    const config = action.config;
    if (action.actionType === "CREATE_TASK") {
      const recordType = config.recordType as CrmWorkflowRecordType;
      const recordId = this.contextId(action.recordContext, recordType);
      if (!recordId) throw new Error("Trigger record is missing");
      let assigneeId: string | null = null;
      if (config.assigneeStrategy === "SPECIFIC_USER") assigneeId = String(config.userId);
      else if (config.assigneeStrategy === "RECORD_OWNER") {
        const table = recordType === "LEAD" ? "crm_leads" : "crm_deals";
        const rows = await manager.query<Row[]>(`SELECT owner_id AS id FROM ${table} WHERE id=$1 AND archived_at IS NULL`, [recordId]);
        assigneeId = rows[0]?.id ?? null;
      }
      const dueAt = new Date(new Date(action.triggeredAt).getTime() + Number(config.dueInDays) * 86_400_000).toISOString();
      const links = recordType === "LEAD" ? { leadId: recordId } : recordType === "DEAL" ? { dealId: recordId } : { organizationId: recordId };
      const task = await this.tasks.createIn(manager, {
        ...links, title: String(config.title), description: config.description as string | null,
        dueAt, priority: config.priority as CrmTaskPriority, kind: config.kind as CrmTaskKind, assignedToUserId: assigneeId,
      }, null, action.id);
      return { taskId: task.id };
    }
    if (action.actionType === "ADD_TAG" || action.actionType === "REMOVE_TAG") {
      const recordType = config.recordType as CrmWorkflowRecordType;
      const recordId = this.contextId(action.recordContext, recordType);
      if (!recordId) throw new Error("Trigger record is missing");
      const result = await this.metadata.applyWorkflowTag(manager, recordType as CrmCustomFieldEntityType, recordId, String(config.tagId), action.actionType === "ADD_TAG");
      return { recordType, recordId, tagId: config.tagId, changed: result.changed };
    }
    if (action.actionType === "ASSIGN_LEAD_OWNER") {
      const recordId = action.recordContext?.leadId;
      if (!recordId) throw new Error("Trigger does not include a Lead");
      return { leadId: recordId, changed: await this.leads.assignOwnerIn(manager, recordId, String(config.userId)) };
    }
    if (action.actionType === "ASSIGN_DEAL_OWNER") {
      const recordId = action.recordContext?.dealId;
      if (!recordId) throw new Error("Trigger does not include a Deal");
      return { dealId: recordId, changed: await this.deals.assignOwnerIn(manager, recordId, String(config.userId)) };
    }
    throw new Error("Unsupported workflow action");
  }

  private async failAction(action: ActionRow, error: unknown) {
    const safe = workflowSafeError(error);
    const retry = isTransientWorkflowError(error) && action.attempt < CRM_WORKFLOW_MAX_ATTEMPTS;
    await this.dataSource.transaction(async (manager) => {
      const status = retry ? "RETRYING" : "FAILED";
      const delay = retry ? workflowRetryDelayMs(action.attempt) : 0;
      await manager.query(`UPDATE crm_workflow_action_executions SET status=$2,next_attempt_at=now()+($3 * interval '1 millisecond'),error_code=$4,error_message=$5,
        completed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END WHERE id=$1 AND status='RUNNING'`, [action.id, status, delay, safe.code, safe.message]);
      await manager.query(`UPDATE crm_workflow_executions SET status=$2,error_code=$3,error_message=$4,failed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END WHERE id=$1`,
        [action.workflowExecutionId, status, safe.code, safe.message]);
    });
  }

  private async failEvent(event: EventRow, error: unknown) {
    const safe = workflowSafeError(error);
    const retry = isTransientWorkflowError(error) && event.attempt < CRM_WORKFLOW_MAX_ATTEMPTS;
    const delay = retry ? workflowRetryDelayMs(event.attempt) : 0;
    await this.dataSource.query(`UPDATE crm_workflow_events SET status=$2,next_attempt_at=now()+($3 * interval '1 millisecond'),claimed_at=NULL,
      error_code=$4,processed_at=CASE WHEN $2='FAILED' THEN now() ELSE NULL END WHERE id=$1 AND status='PROCESSING'`, [event.id, retry ? "PENDING" : "FAILED", delay, safe.code]);
    this.logger.warn(`CRM workflow event ${event.id} failed (${safe.code})`);
  }

  private workflowSnapshot(workflow: Row): Row {
    return { id: workflow.id, name: workflow.name, description: workflow.description ?? null, version: workflow.version, triggerType: workflow.triggerType,
      triggerConfig: workflow.triggerConfig ?? {}, conditionEntityType: workflow.conditionEntityType, conditions: workflow.conditions, actions: workflow.actions };
  }

  private definitionFromWorkflow(workflow: Row) {
    return { name: workflow.name, description: workflow.description ?? null, triggerType: workflow.triggerType, triggerConfig: workflow.triggerConfig ?? {},
      conditionEntityType: workflow.conditionEntityType, conditions: workflow.conditions, actions: workflow.actions, enabled: workflow.enabled };
  }

  private contextId(context: Record<string, string | null>, type: CrmWorkflowRecordType) {
    return context?.[`${type.toLowerCase()}Id`] ?? null;
  }
}
