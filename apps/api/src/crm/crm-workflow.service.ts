import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { CrmLeadService } from "./crm-lead.service";
import { CrmFilterService } from "./crm-filter.service";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CrmDealStage } from "./entities/crm-deal.entity";
import { CrmLeadStatus } from "./entities/crm-lead.entity";
import { CrmTaskKind, CrmTaskPriority } from "./entities/crm-task.entity";
import { CreateCrmWorkflowDto, CrmWorkflowExecutionListDto, UpdateCrmWorkflowDto } from "./dto/crm-workflow.dto";
import { CRM_WORKFLOW_ACTIONS, CRM_WORKFLOW_MAX_ACTIONS, CRM_WORKFLOW_MAX_ENABLED, CRM_WORKFLOW_TRIGGERS, CrmWorkflowActionType, CrmWorkflowRecordType, CrmWorkflowTrigger } from "./crm-workflow.util";

type Row = Record<string, any>;
type Action = { type: CrmWorkflowActionType; config: Record<string, unknown> };
type Definition = {
  name: string; description: string | null; triggerType: CrmWorkflowTrigger; triggerConfig: Record<string, unknown>;
  conditionEntityType: CrmWorkflowRecordType; conditions: Record<string, unknown>; actions: Action[]; enabled: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const priorities = Object.values(CrmTaskPriority);
const taskKinds = Object.values(CrmTaskKind);
const leadStatuses = Object.values(CrmLeadStatus);
const dealStages = Object.values(CrmDealStage);
const recordTypes = ["ORGANIZATION", "LEAD", "DEAL"] as const;

@Injectable()
export class CrmWorkflowService {
  constructor(private readonly dataSource: DataSource, private readonly filters: CrmFilterService, private readonly leads: CrmLeadService) {}

  async list() {
    return this.dataSource.query<Row[]>(`${this.selectWorkflow()} WHERE archived_at IS NULL ORDER BY created_at DESC,id`);
  }

  async get(id: string) {
    const workflow = await this.getWorkflow(this.dataSource, id);
    return { ...workflow, valid: await this.isValid(workflow) };
  }

  async create(input: CreateCrmWorkflowDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const definition = this.toDefinition(input);
      await this.validateDefinition(manager, definition);
      if (definition.enabled) await this.assertEnabledCapacity(manager);
      const rows = await manager.query<Row[]>(`INSERT INTO crm_workflows(name,description,trigger_type,trigger_config,condition_entity_type,conditions,actions,enabled,created_by_user_id,updated_by_user_id)
        VALUES($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9,$9) RETURNING id`, [definition.name, definition.description, definition.triggerType,
        JSON.stringify(definition.triggerConfig), definition.conditionEntityType, JSON.stringify(definition.conditions), JSON.stringify(definition.actions), definition.enabled, actorId]);
      const id = rows[0]!.id as string;
      await this.audit(manager, actorId, "crm.workflow.created", id, { triggerType: definition.triggerType });
      return this.getWorkflow(manager, id);
    });
  }

  async update(id: string, input: UpdateCrmWorkflowDto, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const current = await this.getWorkflow(manager, id, true);
      const definition = this.toDefinition({ ...current, ...input } as CreateCrmWorkflowDto);
      await this.validateDefinition(manager, definition);
      if (definition.enabled && !current.enabled) await this.assertEnabledCapacity(manager);
      await manager.query(`UPDATE crm_workflows SET name=$2,description=$3,trigger_type=$4,trigger_config=$5::jsonb,condition_entity_type=$6,
        conditions=$7::jsonb,actions=$8::jsonb,enabled=$9,version=version+1,updated_by_user_id=$10,updated_at=now() WHERE id=$1`, [id,
        definition.name, definition.description, definition.triggerType, JSON.stringify(definition.triggerConfig), definition.conditionEntityType,
        JSON.stringify(definition.conditions), JSON.stringify(definition.actions), definition.enabled, actorId]);
      const action = current.enabled === definition.enabled ? "crm.workflow.updated" : definition.enabled ? "crm.workflow.enabled" : "crm.workflow.disabled";
      await this.audit(manager, actorId, action, id, { triggerType: definition.triggerType });
      return this.getWorkflow(manager, id);
    });
  }

  async archive(id: string, actorId: string) {
    return this.dataSource.transaction(async (manager) => {
      const workflow = await this.getWorkflow(manager, id, true);
      if (workflow.archivedAt) return workflow;
      await manager.query("UPDATE crm_workflows SET enabled=false,archived_at=now(),updated_by_user_id=$2,updated_at=now(),version=version+1 WHERE id=$1", [id, actorId]);
      await this.audit(manager, actorId, "crm.workflow.archived", id, { triggerType: workflow.triggerType });
      return this.getWorkflow(manager, id);
    });
  }

  async executions(workflowId: string, query: CrmWorkflowExecutionListDto) {
    await this.getWorkflow(this.dataSource, workflowId);
    const where = query.status ? "AND e.status=$2" : "";
    const values: unknown[] = query.status ? [workflowId, query.status] : [workflowId];
    const count = await this.dataSource.query<Row[]>(`SELECT count(*)::int AS total FROM crm_workflow_executions e WHERE e.workflow_id=$1 ${where}`, values);
    const listValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const rows = await this.dataSource.query<Row[]>(`SELECT e.id,e.workflow_id AS "workflowId",e.workflow_version AS "workflowVersion",e.trigger_type AS "triggerType",
      e.record_type AS "recordType",e.record_id AS "recordId",e.status,e.error_code AS "errorCode",e.error_message AS "errorMessage",
      e.correlation_id AS "correlationId",e.automation_depth AS "automationDepth",e.started_at AS "startedAt",e.completed_at AS "completedAt",e.failed_at AS "failedAt",
      (SELECT count(*)::int FROM crm_workflow_action_executions a WHERE a.workflow_execution_id=e.id) AS "actionCount",
      (SELECT count(*)::int FROM crm_workflow_action_executions a WHERE a.workflow_execution_id=e.id AND a.status='SUCCEEDED') AS "succeededActions"
      FROM crm_workflow_executions e WHERE e.workflow_id=$1 ${where} ORDER BY e.created_at DESC,e.id DESC LIMIT $${listValues.length - 1} OFFSET $${listValues.length}`, listValues);
    return { items: rows, total: Number(count[0]?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async execution(id: string) {
    const rows = await this.dataSource.query<Row[]>(`SELECT e.id,e.workflow_id AS "workflowId",w.name AS "workflowName",e.event_id AS "eventId",
      e.workflow_version AS "workflowVersion",e.trigger_type AS "triggerType",e.record_type AS "recordType",e.record_id AS "recordId",e.status,
      e.workflow_snapshot AS "workflowSnapshot",ev.event_context AS "triggerContext",ev.created_at AS "triggeredAt",e.error_code AS "errorCode",
      e.error_message AS "errorMessage",e.correlation_id AS "correlationId",e.automation_depth AS "automationDepth",e.started_at AS "startedAt",
      e.completed_at AS "completedAt",e.failed_at AS "failedAt" FROM crm_workflow_executions e
      JOIN crm_workflows w ON w.id=e.workflow_id JOIN crm_workflow_events ev ON ev.id=e.event_id WHERE e.id=$1`, [id]);
    if (!rows[0]) throw new NotFoundException("CRM workflow execution not found");
    const actions = await this.dataSource.query<Row[]>(`SELECT id,action_index AS "actionIndex",action_type AS "actionType",config,status,attempt,
      manual_retry_count AS "manualRetryCount",started_at AS "startedAt",completed_at AS "completedAt",result_metadata AS "resultMetadata",
      error_code AS "errorCode",error_message AS "errorMessage",next_attempt_at AS "nextAttemptAt" FROM crm_workflow_action_executions
      WHERE workflow_execution_id=$1 ORDER BY action_index`, [id]);
    return { ...rows[0], actions };
  }

  async retryExecution(id: string, actorId: string) {
    await this.dataSource.transaction(async (manager) => {
      const rows = await manager.query<Row[]>("SELECT status FROM crm_workflow_executions WHERE id=$1 FOR UPDATE", [id]);
      if (!rows[0]) throw new NotFoundException("CRM workflow execution not found");
      if (rows[0].status !== "FAILED") throw new ConflictException("Only failed executions can be retried");
      const failed = await manager.query<Row[]>(`SELECT id,manual_retry_count FROM crm_workflow_action_executions WHERE workflow_execution_id=$1 AND status='FAILED' ORDER BY action_index LIMIT 1 FOR UPDATE`, [id]);
      if (!failed[0]) throw new ConflictException("This execution has no retryable action");
      if (Number(failed[0].manual_retry_count) >= 3) throw new ConflictException("This action has reached the manual retry limit");
      await manager.query("UPDATE crm_workflow_action_executions SET status='PENDING',attempt=0,manual_retry_count=manual_retry_count+1,next_attempt_at=now(),error_code=NULL,error_message=NULL,started_at=NULL,completed_at=NULL WHERE id=$1", [failed[0].id]);
      await manager.query("UPDATE crm_workflow_executions SET status='PENDING',error_code=NULL,error_message=NULL,failed_at=NULL,completed_at=NULL WHERE id=$1", [id]);
      await this.audit(manager, actorId, "crm.workflow_execution.retry_requested", id, {});
    });
    return this.execution(id);
  }

  async validateDefinition(manager: EntityManager, definition: Definition) {
    if (!CRM_WORKFLOW_TRIGGERS.includes(definition.triggerType)) throw new BadRequestException("Workflow trigger is not supported");
    this.validateTriggerConfig(definition.triggerType, definition.triggerConfig);
    if (!recordTypes.includes(definition.conditionEntityType)) throw new BadRequestException("Workflow condition record type is not supported");
    if (definition.triggerType === "TRIAL_ENDING" && definition.conditionEntityType !== "ORGANIZATION") throw new BadRequestException("Trial ending Workflows must evaluate an Organization");
    if (!Array.isArray(definition.actions) || definition.actions.length < 1 || definition.actions.length > CRM_WORKFLOW_MAX_ACTIONS) throw new BadRequestException("A Workflow needs 1–10 actions");
    await this.filters.compile(definition.conditionEntityType as CrmCustomFieldEntityType, definition.conditions, [], { entity: "e", organization: "o" }, manager);
    const actions: Action[] = [];
    for (const raw of definition.actions) {
      const action = await this.validateAction(manager, raw);
      if (action.type === "ASSIGN_LEAD_OWNER" && definition.conditionEntityType !== "LEAD") throw new BadRequestException("Lead owner assignment requires Lead conditions");
      if (action.type === "ASSIGN_DEAL_OWNER" && definition.conditionEntityType !== "DEAL") throw new BadRequestException("Deal owner assignment requires Deal conditions");
      if ((action.type === "CREATE_TASK" || action.type === "ADD_TAG" || action.type === "REMOVE_TAG") && action.config.recordType !== definition.conditionEntityType) throw new BadRequestException("Action record type must match the condition record type");
      actions.push(action);
    }
    definition.actions = actions;
  }

  async conditionsMatch(manager: EntityManager, type: CrmWorkflowRecordType, id: string, criteria: Record<string, unknown>) {
    const values: unknown[] = [id];
    const predicate = await this.filters.compile(type as CrmCustomFieldEntityType, criteria, values, { entity: "e", organization: "o" }, manager);
    const source: Record<CrmWorkflowRecordType, string> = {
      ORGANIZATION: "FROM crm_organizations e",
      LEAD: "FROM crm_leads e LEFT JOIN crm_organizations o ON o.id=e.organization_id",
      DEAL: "FROM crm_deals e LEFT JOIN crm_organizations o ON o.id=e.organization_id",
    };
    const rows = await manager.query<Row[]>(`SELECT e.id ${source[type]} WHERE e.id=$1 AND e.archived_at IS NULL${predicate ? ` AND (${predicate})` : ""} LIMIT 1`, values);
    return Boolean(rows[0]);
  }

  private validateTriggerConfig(trigger: CrmWorkflowTrigger, config: Record<string, unknown>) {
    this.assertObject(config, "Trigger configuration");
    const allowed: Record<CrmWorkflowTrigger, string[]> = {
      LEAD_CREATED: [], LEAD_QUALIFIED: [], LEAD_CONVERTED: [], LEAD_STATUS_CHANGED: ["fromStatus", "toStatus"],
      DEAL_CREATED: [], DEAL_STAGE_CHANGED: ["fromStage", "toStage"], DEAL_WON: [], DEAL_LOST: [], ACTIVITY_CREATED: [], TASK_COMPLETED: [],
      LEAD_SCORE_CHANGED: [], LEAD_SCORE_CROSSED_THRESHOLD: ["threshold", "direction"], TASK_OVERDUE: [], TRIAL_ENDING: ["daysBefore"],
    };
    this.assertKeys(config, allowed[trigger]);
    if (trigger === "LEAD_STATUS_CHANGED") for (const key of ["fromStatus", "toStatus"]) if (config[key] !== undefined && !leadStatuses.includes(config[key] as CrmLeadStatus)) throw new BadRequestException("Lead status trigger value is invalid");
    if (trigger === "DEAL_STAGE_CHANGED") for (const key of ["fromStage", "toStage"]) if (config[key] !== undefined && !dealStages.includes(config[key] as CrmDealStage)) throw new BadRequestException("Deal stage trigger value is invalid");
    if (trigger === "LEAD_SCORE_CROSSED_THRESHOLD" && (!Number.isInteger(config.threshold) || Number(config.threshold) < 1 || Number(config.threshold) > 100 || !["ABOVE", "BELOW"].includes(String(config.direction)))) throw new BadRequestException("Score crossing needs a threshold from 1–100 and direction ABOVE or BELOW");
    if (trigger === "TRIAL_ENDING" && (!Number.isInteger(config.daysBefore) || Number(config.daysBefore) < 1 || Number(config.daysBefore) > 30)) throw new BadRequestException("Trial ending window must be 1–30 days");
  }

  private async validateAction(manager: EntityManager, raw: Record<string, unknown>): Promise<Action> {
    this.assertObject(raw, "Workflow action");
    this.assertKeys(raw, ["type", "config"]);
    const type = raw.type as CrmWorkflowActionType;
    if (!CRM_WORKFLOW_ACTIONS.includes(type)) throw new BadRequestException("Workflow action is not supported");
    this.assertObject(raw.config, "Action configuration");
    const config = raw.config as Record<string, unknown>;
    if (type === "CREATE_TASK") {
      this.assertKeys(config, ["recordType", "title", "description", "dueInDays", "priority", "kind", "assigneeStrategy", "userId"]);
      const recordType = this.recordType(config.recordType);
      if (typeof config.title !== "string" || !config.title.trim() || config.title.trim().length > 200) throw new BadRequestException("Task title is required and must be at most 200 characters");
      if (config.description != null && (typeof config.description !== "string" || config.description.length > 4000)) throw new BadRequestException("Task description must be at most 4,000 characters");
      if (!Number.isInteger(config.dueInDays) || Number(config.dueInDays) < 1 || Number(config.dueInDays) > 365) throw new BadRequestException("Task due offset must be 1–365 days");
      if (config.priority !== undefined && !priorities.includes(config.priority as CrmTaskPriority)) throw new BadRequestException("Task priority is invalid");
      if (config.kind !== undefined && !taskKinds.includes(config.kind as CrmTaskKind)) throw new BadRequestException("Task kind is invalid");
      const strategy = config.assigneeStrategy ?? "UNASSIGNED";
      if (!["RECORD_OWNER", "SPECIFIC_USER", "UNASSIGNED"].includes(String(strategy))) throw new BadRequestException("Task assignee strategy is invalid");
      if (strategy === "RECORD_OWNER" && recordType === "ORGANIZATION") throw new BadRequestException("Organizations do not have a CRM owner");
      if (strategy === "SPECIFIC_USER") {
        if (typeof config.userId !== "string" || !uuid.test(config.userId)) throw new BadRequestException("Choose an active CRM user for the Task");
        await this.leads.assertCrmAssignee(manager, config.userId);
      } else if (config.userId !== undefined && config.userId !== null) throw new BadRequestException("A user ID is only valid with SPECIFIC_USER assignment");
      return { type, config: { recordType, title: config.title.trim(), description: config.description ?? null, dueInDays: config.dueInDays, priority: config.priority ?? CrmTaskPriority.Normal, kind: config.kind ?? CrmTaskKind.FollowUp, assigneeStrategy: strategy, userId: config.userId ?? null } };
    }
    if (type === "ADD_TAG" || type === "REMOVE_TAG") {
      this.assertKeys(config, ["recordType", "tagId"]);
      const recordType = this.recordType(config.recordType);
      if (typeof config.tagId !== "string" || !uuid.test(config.tagId)) throw new BadRequestException("Choose a CRM Tag");
      const tag = await manager.query<Row[]>("SELECT id FROM crm_tags WHERE id=$1 AND active=TRUE AND archived_at IS NULL", [config.tagId]);
      if (!tag[0]) throw new BadRequestException("Workflow references a missing or archived Tag");
      return { type, config: { recordType, tagId: config.tagId } };
    }
    this.assertKeys(config, ["userId"]);
    if (typeof config.userId !== "string" || !uuid.test(config.userId)) throw new BadRequestException("Choose an active CRM user");
    await this.leads.assertCrmAssignee(manager, config.userId);
    return { type, config: { userId: config.userId } };
  }

  private toDefinition(input: CreateCrmWorkflowDto): Definition {
    return {
      name: input.name.trim(), description: input.description?.trim() || null, triggerType: input.triggerType,
      triggerConfig: input.triggerConfig ?? {}, conditionEntityType: input.conditionEntityType, conditions: input.conditions,
      actions: input.actions as unknown as Action[], enabled: input.enabled ?? false,
    };
  }

  private async isValid(workflow: Row): Promise<boolean> {
    try {
      await this.validateDefinition(this.dataSource.manager, {
        name: workflow.name, description: workflow.description ?? null, triggerType: workflow.triggerType, triggerConfig: workflow.triggerConfig ?? {},
        conditionEntityType: workflow.conditionEntityType, conditions: workflow.conditions, actions: workflow.actions, enabled: workflow.enabled,
      });
      return true;
    } catch { return false; }
  }

  private async assertEnabledCapacity(manager: EntityManager) {
    await manager.query("SELECT pg_advisory_xact_lock(hashtext('crm-workflow-enabled-count'))");
    const rows = await manager.query<Row[]>("SELECT count(*)::int AS total FROM crm_workflows WHERE enabled=true AND archived_at IS NULL");
    if (Number(rows[0]?.total ?? 0) >= CRM_WORKFLOW_MAX_ENABLED) throw new ConflictException(`At most ${CRM_WORKFLOW_MAX_ENABLED} Workflows can be enabled`);
  }

  private selectWorkflow() {
    return `SELECT id,name,description,trigger_type AS "triggerType",trigger_config AS "triggerConfig",condition_entity_type AS "conditionEntityType",
      conditions,actions,enabled,version,created_by_user_id AS "createdByUserId",updated_by_user_id AS "updatedByUserId",
      created_at AS "createdAt",updated_at AS "updatedAt",archived_at AS "archivedAt" FROM crm_workflows`;
  }

  private async getWorkflow(manager: DataSource | EntityManager, id: string, lock = false): Promise<Row> {
    const rows = await manager.query<Row[]>(`${this.selectWorkflow()} WHERE id=$1 AND archived_at IS NULL ${lock ? "FOR UPDATE" : ""}`, [id]);
    if (!rows[0]) throw new NotFoundException("CRM Workflow not found");
    return rows[0];
  }

  private async audit(manager: EntityManager, actorId: string, action: string, id: string, summary: Record<string, unknown>) {
    await manager.query("INSERT INTO platform_audit_events(actor_user_id,action,target_type,target_id,summary) VALUES($1,$2,'crm_workflow',$3,$4::jsonb)", [actorId, action, id, JSON.stringify(summary)]);
  }

  private recordType(value: unknown): CrmWorkflowRecordType {
    if (recordTypes.includes(value as CrmWorkflowRecordType)) return value as CrmWorkflowRecordType;
    throw new BadRequestException("Workflow record type is invalid");
  }

  private assertObject(value: unknown, name: string): asserts value is Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new BadRequestException(`${name} must be an object`);
  }

  private assertKeys(value: Record<string, unknown>, allowed: string[]) {
    if (Object.keys(value).some((key) => !allowed.includes(key))) throw new BadRequestException("Unknown Workflow configuration property");
  }
}
