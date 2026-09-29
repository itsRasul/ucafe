import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CreateTenantCrmAutomationDto, PreviewTenantCrmAutomationDto, TenantCrmAutomationExecutionListQueryDto,
  TenantCrmAutomationListQueryDto, UpdateTenantCrmAutomationDto } from "./dto/tenant-crm-automations.dto";
import { TenantCrmService } from "./tenant-crm.service";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";
import { automationError, automationRetryDelay, AUTOMATION_MAX_ATTEMPTS, AUTOMATION_MAX_DEPTH, AUTOMATION_STALE_MS,
  TenantCrmAutomationAction, TenantCrmAutomationError, TenantCrmAutomationTrigger } from "./tenant-crm-automation.util";

type Row = Record<string, any>;
type Definition = { id: string; coffeeShopId: string; name: string; description: string | null; status: string; triggerType: TenantCrmAutomationTrigger;
  triggerConfig: Record<string, unknown>; conditions: unknown; actions: Array<{ type: TenantCrmAutomationAction; config: Record<string, unknown> }>;
  version: number; activatedAt: Date | null };

const eventTriggers: Record<string, TenantCrmAutomationTrigger> = {
  "tenant.order.delivered": "ORDER_DELIVERED",
  "tenant.crm.feedback.created": "FEEDBACK_CREATED",
  "tenant.crm.feedback.resolved": "FEEDBACK_RESOLVED",
};

@Injectable()
export class TenantCrmAutomationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TenantCrmAutomationService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastTimeScanAt = 0;

  constructor(private readonly dataSource: DataSource, private readonly crm: TenantCrmService,
    private readonly segments: TenantCrmSegmentsService, private readonly subscriptions: SubscriptionsService) {}

  onModuleInit() { this.timer = setInterval(() => void this.process().catch(() => this.logger.warn("Automation worker pass failed.")), 5_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async metadata(coffeeShopId: string, triggerType: TenantCrmAutomationTrigger) {
    return {
      triggerType,
      fields: await this.segments.automationFields(coffeeShopId, triggerType),
      tags: await this.crm.listTags(coffeeShopId),
      users: await this.crm.listActiveTenantUsers(coffeeShopId),
      actions: [
        { type: "ADD_TAG", label: "افزودن برچسب" }, { type: "REMOVE_TAG", label: "حذف برچسب" },
        { type: "CREATE_REMINDER", label: "ساخت یادآور" }, { type: "ADD_NOTE", label: "ثبت یادداشت" },
      ],
    };
  }

  async list(coffeeShopId: string, query: TenantCrmAutomationListQueryDto) {
    const values: unknown[] = [coffeeShopId];
    const where = ["coffee_shop_id=$1"];
    if (query.status) { values.push(query.status); where.push(`status=$${values.length}`); }
    if (query.triggerType) { values.push(query.triggerType); where.push(`trigger_type=$${values.length}`); }
    if (query.q) { values.push(query.q); where.push(`strpos(lower(name),lower($${values.length}::text))>0`); }
    const [count] = await this.dataSource.query<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total FROM tenant_crm_automations WHERE ${where.join(" AND ")}`, values);
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`${this.selectAutomationSql()} WHERE ${where.join(" AND ")}
      ORDER BY updated_at DESC,id DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async detail(coffeeShopId: string, automationId: string) { return this.getDefinition(this.dataSource, coffeeShopId, automationId); }

  async createDraft(coffeeShopId: string, actorId: string, input: CreateTenantCrmAutomationDto, timeZone: string) {
    const definition = this.definitionInput(input);
    await this.validateDefinition(coffeeShopId, timeZone, definition);
    const rows = await this.dataSource.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_automations
      (coffee_shop_id,name,description,trigger_type,trigger_config,conditions,actions,created_by_user_id)
      VALUES($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8) RETURNING id`,
    [coffeeShopId, definition.name, definition.description, definition.triggerType, JSON.stringify(definition.triggerConfig),
      definition.conditions == null ? null : JSON.stringify(definition.conditions), JSON.stringify(definition.actions), actorId]);
    return this.detail(coffeeShopId, rows[0]!.id);
  }

  async update(coffeeShopId: string, timeZone: string, automationId: string, input: UpdateTenantCrmAutomationDto) {
    const current = await this.detail(coffeeShopId, automationId);
    if (current.status === "ARCHIVED") throw new ConflictException("Archived automations cannot be edited");
    const definition = this.definitionInput({ ...current, ...input } as CreateTenantCrmAutomationDto);
    await this.validateDefinition(coffeeShopId, timeZone, definition);
    const rows = await this.dataSource.query<Array<{ id: string }>>(`UPDATE tenant_crm_automations SET name=$3,description=$4,trigger_type=$5,
      trigger_config=$6::jsonb,conditions=$7::jsonb,actions=$8::jsonb,version=version+1,updated_at=clock_timestamp()
      WHERE coffee_shop_id=$1 AND id=$2 AND status<>'ARCHIVED' RETURNING id`,
    [coffeeShopId, automationId, definition.name, definition.description, definition.triggerType, JSON.stringify(definition.triggerConfig),
      definition.conditions == null ? null : JSON.stringify(definition.conditions), JSON.stringify(definition.actions)]);
    if (!rows[0]) throw new NotFoundException("Automation not found");
    return this.detail(coffeeShopId, automationId);
  }

  async activate(coffeeShopId: string, timeZone: string, automationId: string) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(`SELECT id FROM coffee_shops WHERE id=$1 FOR UPDATE`, [coffeeShopId]);
      const definition = await this.getDefinition(manager, coffeeShopId, automationId);
      if (definition.status === "ARCHIVED") throw new ConflictException("Archived automations cannot be activated");
      await this.validateDefinition(coffeeShopId, timeZone, definition);
      const rows = await manager.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_automations
        WHERE coffee_shop_id=$1 AND status='ACTIVE'`, [coffeeShopId]);
      if (definition.status !== "ACTIVE" && Number(rows[0]?.total ?? 0) >= 100)
        throw new ConflictException("A café can have at most 100 active automations");
      await manager.query(`UPDATE tenant_crm_automations SET status='ACTIVE',activated_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, automationId]);
      return this.getDefinition(manager, coffeeShopId, automationId);
    });
  }

  async pause(coffeeShopId: string, automationId: string) { return this.transition(coffeeShopId, automationId, "PAUSED", ["ACTIVE"]); }
  async archive(coffeeShopId: string, automationId: string) { return this.transition(coffeeShopId, automationId, "ARCHIVED", ["DRAFT", "PAUSED"]); }

  private async transition(coffeeShopId: string, automationId: string, next: string, allowed: string[]) {
    const rows = await this.dataSource.query<Array<{ id: string }>>(`UPDATE tenant_crm_automations SET status=$3,updated_at=clock_timestamp()
      WHERE coffee_shop_id=$1 AND id=$2 AND status=ANY($4::text[]) RETURNING id`, [coffeeShopId, automationId, next, allowed]);
    if (!rows[0]) {
      const current = await this.detail(coffeeShopId, automationId);
      throw new ConflictException(`Cannot ${next.toLowerCase()} an automation in ${current.status} status`);
    }
    return this.detail(coffeeShopId, automationId);
  }

  async preview(coffeeShopId: string, timeZone: string, input: PreviewTenantCrmAutomationDto) {
    if (input.triggerType !== "CLIENT_LAPSED" && input.triggerType !== "CLIENT_BIRTHDAY")
      throw new BadRequestException("Preview is available for café-local time triggers only");
    const config = this.validateTriggerConfig(input.triggerType, input.triggerConfig);
    const conditions = input.triggerType === "CLIENT_LAPSED" || input.triggerType === "CLIENT_BIRTHDAY"
      ? this.timeCriteria(input.triggerType, config, input.conditions) : input.conditions;
    await this.segments.validateAutomationCriteria(coffeeShopId, timeZone, input.triggerType, conditions);
    const result = await this.segments.preview(coffeeShopId, timeZone, conditions);
    return { matchingClients: result.matchingClients };
  }

  async executions(coffeeShopId: string, automationId: string, query: TenantCrmAutomationExecutionListQueryDto) {
    await this.detail(coffeeShopId, automationId);
    const values: unknown[] = [coffeeShopId, automationId];
    const where = ["e.coffee_shop_id=$1", "e.automation_id=$2"];
    if (query.status) { values.push(query.status); where.push(`e.status=$${values.length}`); }
    const [count] = await this.dataSource.query<Array<{ total: string }>>(`SELECT COUNT(*)::text AS total FROM tenant_crm_automation_executions e WHERE ${where.join(" AND ")}`, values);
    const pageValues = [...values, query.pageSize, (query.page - 1) * query.pageSize];
    const items = await this.dataSource.query<Row[]>(`${this.executionSelectSql()} WHERE ${where.join(" AND ")}
      ORDER BY e.created_at DESC,e.id DESC LIMIT $${pageValues.length - 1} OFFSET $${pageValues.length}`, pageValues);
    return { items, total: Number(count?.total ?? 0), page: query.page, pageSize: query.pageSize };
  }

  async executionDetail(coffeeShopId: string, executionId: string) {
    const [execution] = await this.dataSource.query<Row[]>(`${this.executionSelectSql()} WHERE e.coffee_shop_id=$1 AND e.id=$2`, [coffeeShopId, executionId]);
    if (!execution) throw new NotFoundException("Automation execution not found");
    execution.actionExecutions = await this.dataSource.query<Row[]>(`SELECT id,action_index AS "actionIndex",action_type AS "actionType",config,
      status,attempts,error_code AS "errorCode",error_message AS "errorMessage",result_metadata AS "resultMetadata",created_at AS "createdAt",
      completed_at AS "completedAt" FROM tenant_crm_automation_actions WHERE coffee_shop_id=$1 AND automation_execution_id=$2 ORDER BY action_index`,
    [coffeeShopId, executionId]);
    return execution;
  }

  private async process() {
    if (this.running || !this.dataSource.isInitialized) return;
    this.running = true;
    try {
      await this.recoverStale();
      await this.dispatchEvents(20);
      if (Date.now() - this.lastTimeScanAt >= 60_000) {
        this.lastTimeScanAt = Date.now();
        await this.scanTimeTriggers();
      }
      await this.processExecutions(20);
      await this.processActions(50);
      await this.finishExecutions();
    } finally { this.running = false; }
  }

  private async recoverStale() {
    await this.dataSource.query(`UPDATE domain_event_outbox SET automation_dispatch_status=CASE WHEN automation_dispatch_attempts>=$1 THEN 'FAILED' ELSE 'PENDING' END,
      automation_dispatch_claimed_at=NULL,automation_dispatch_next_attempt_at=clock_timestamp(),automation_dispatch_error_code=CASE WHEN automation_dispatch_attempts>=$1 THEN 'STALE_EVENT_DISPATCH' ELSE NULL END
      WHERE automation_dispatch_status='PROCESSING' AND automation_dispatch_claimed_at<clock_timestamp()-($2::int*interval '1 millisecond')`,
    [AUTOMATION_MAX_ATTEMPTS, AUTOMATION_STALE_MS]);
    await this.dataSource.query(`UPDATE tenant_crm_automation_executions SET status=CASE WHEN attempts>=$1 THEN 'FAILED' ELSE 'PENDING' END,
      claimed_at=NULL,next_attempt_at=clock_timestamp(),failed_at=CASE WHEN attempts>=$1 THEN clock_timestamp() ELSE NULL END,
      error_code=CASE WHEN attempts>=$1 THEN 'STALE_EXECUTION' ELSE NULL END,error_message=CASE WHEN attempts>=$1 THEN 'Automation execution stopped unexpectedly.' ELSE NULL END
      WHERE status='PROCESSING' AND conditions_evaluated_at IS NULL AND claimed_at<clock_timestamp()-($2::int*interval '1 millisecond')`,
    [AUTOMATION_MAX_ATTEMPTS, AUTOMATION_STALE_MS]);
    await this.dataSource.query(`UPDATE tenant_crm_automation_actions SET status=CASE WHEN attempts>=$1 THEN 'FAILED' ELSE 'PENDING' END,
      claimed_at=NULL,next_attempt_at=clock_timestamp(),error_code=CASE WHEN attempts>=$1 THEN 'STALE_ACTION' ELSE NULL END,
      error_message=CASE WHEN attempts>=$1 THEN 'Automation action stopped unexpectedly.' ELSE NULL END
      WHERE status='PROCESSING' AND claimed_at<clock_timestamp()-($2::int*interval '1 millisecond')`,
    [AUTOMATION_MAX_ATTEMPTS, AUTOMATION_STALE_MS]);
  }

  private async dispatchEvents(limit: number) {
    for (let i = 0; i < limit; i++) {
      const [event] = await this.dataSource.query<Row[]>(`WITH candidate AS (
          SELECT id FROM domain_event_outbox WHERE event_type=ANY($1::text[]) AND automation_dispatch_attempts<$2
            AND ((automation_dispatch_status='PENDING' AND automation_dispatch_next_attempt_at<=clock_timestamp())
              OR (automation_dispatch_status='PROCESSING' AND automation_dispatch_claimed_at<clock_timestamp()-($3::int*interval '1 millisecond')))
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
        ), claimed AS (UPDATE domain_event_outbox e SET automation_dispatch_status='PROCESSING',automation_dispatch_attempts=automation_dispatch_attempts+1,
          automation_dispatch_claimed_at=clock_timestamp(),automation_dispatch_error_code=NULL FROM candidate c WHERE e.id=c.id RETURNING e.*)
        SELECT id,event_type AS "eventType",coffee_shop_id AS "coffeeShopId",aggregate_id AS "aggregateId",payload,
          created_at AS "createdAt",automation_dispatch_attempts AS attempts,automation_dispatch_status AS status,
          correlation_id AS "correlationId",causation_execution_id AS "causationExecutionId",automation_depth AS depth FROM claimed`,
      [[...Object.keys(eventTriggers)], AUTOMATION_MAX_ATTEMPTS, AUTOMATION_STALE_MS]);
      if (!event) break;
      await this.dispatchEvent(event).catch((error) => this.failEvent(event, error));
    }
  }

  private async dispatchEvent(event: Row) {
    await this.dataSource.transaction(async (manager) => {
      const [locked] = await manager.query<Row[]>(`SELECT id FROM domain_event_outbox WHERE id=$1 AND automation_dispatch_status='PROCESSING' FOR UPDATE`, [event.id]);
      if (!locked) return;
      if (!(await this.subscriptions.featureState(event.coffeeShopId, SubscriptionFeatures.TenantCrm, new Date(), manager)).enabled) {
        await manager.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PROCESSED',automation_dispatched_at=clock_timestamp(),automation_dispatch_claimed_at=NULL WHERE id=$1`, [event.id]);
        return;
      }
      if (Number(event.depth) >= AUTOMATION_MAX_DEPTH) {
        await manager.query(`UPDATE domain_event_outbox SET automation_dispatch_status='LOOP_BLOCKED',automation_dispatched_at=clock_timestamp(),automation_dispatch_claimed_at=NULL,automation_dispatch_error_code='AUTOMATION_DEPTH_LIMIT' WHERE id=$1`, [event.id]);
        return;
      }
      const triggerType = eventTriggers[event.eventType] as TenantCrmAutomationTrigger;
      const rows = await manager.query<Definition[]>(`SELECT ${this.definitionColumns()} FROM tenant_crm_automations
        WHERE coffee_shop_id=$1 AND status='ACTIVE' AND trigger_type=$2 AND activated_at<=$3 ORDER BY id FOR SHARE`,
      [event.coffeeShopId, triggerType, event.createdAt]);
      const payload = this.parseJson(event.payload);
      const [client] = await manager.query<Array<{ id: string }>>(`SELECT id FROM clients WHERE coffee_shop_id=$1 AND id=$2`,
        [event.coffeeShopId, String(payload.clientId ?? "")]);
      if (!client) {
        await manager.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PROCESSED',automation_dispatched_at=clock_timestamp(),automation_dispatch_claimed_at=NULL WHERE id=$1`, [event.id]);
        return;
      }
      const triggerData = await this.eventData(manager, event.coffeeShopId, event.aggregateId, triggerType, payload);
      const clientId = String(payload.clientId ?? "");
      const subjectType = triggerType.startsWith("FEEDBACK_") ? "FEEDBACK" : "ORDER";
      for (const definition of rows) {
        const loopBlocked = await this.isCausalLoop(manager, event.coffeeShopId, event.causationExecutionId, definition.id);
        await this.insertExecution(manager, definition, { clientId, subjectType, subjectId: event.aggregateId,
          sourceEventId: event.id, occurrenceKey: `EVENT:${event.id}`, triggerData,
          causationExecutionId: event.causationExecutionId, correlationId: event.correlationId, depth: Number(event.depth), loopBlocked });
      }
      await manager.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PROCESSED',automation_dispatched_at=clock_timestamp(),automation_dispatch_claimed_at=NULL WHERE id=$1`, [event.id]);
    });
  }

  private async failEvent(event: Row, error: unknown) {
    const mapped = automationError(error, "Automation event could not be processed.");
    const driverCode = (error as { driverError?: { code?: string }; code?: string } | null)?.driverError?.code ??
      (error as { code?: string } | null)?.code;
    const terminal = !mapped.retryable || Number(event.attempts) >= AUTOMATION_MAX_ATTEMPTS;
    const code = terminal ? mapped.code : null;
    await this.dataSource.query(`UPDATE domain_event_outbox SET automation_dispatch_status=$2,automation_dispatch_claimed_at=NULL,
      automation_dispatch_next_attempt_at=clock_timestamp()+($3::int*interval '1 millisecond'),
      automation_dispatch_error_code=$4 WHERE id=$1 AND automation_dispatch_status='PROCESSING'`,
    [event.id, terminal ? "FAILED" : "PENDING", automationRetryDelay(Number(event.attempts)), code]);
    this.logger.warn(`Tenant CRM automation event ${event.id} failed (${mapped.code}${driverCode ? `; database ${driverCode}` : ""})`);
  }

  private async scanTimeTriggers() {
    await this.dataSource.transaction(async (manager) => {
      const locks = await manager.query<Array<{ locked: boolean }>>(`SELECT pg_try_advisory_xact_lock(hashtext('tenant-crm-automation-time-scan')) AS locked`);
      if (!locks[0]?.locked) return;
      const automations = await manager.query<Definition[]>(`WITH candidate AS (
        SELECT coffee_shop_id,id FROM tenant_crm_automations WHERE status='ACTIVE' AND trigger_type=ANY($1::text[])
        ORDER BY time_scanned_at ASC NULLS FIRST,id FOR UPDATE SKIP LOCKED LIMIT 100
      ), updated AS (
        UPDATE tenant_crm_automations SET time_scanned_at=clock_timestamp()
        WHERE (coffee_shop_id,id) IN (SELECT coffee_shop_id,id FROM candidate) RETURNING coffee_shop_id,id
      ) SELECT ${this.definitionColumns()} FROM tenant_crm_automations
        WHERE (coffee_shop_id,id) IN (SELECT coffee_shop_id,id FROM updated) ORDER BY id`,
      [["CLIENT_LAPSED", "CLIENT_BIRTHDAY"]]);
      for (const definition of automations) {
        if (!(await this.subscriptions.featureState(definition.coffeeShopId, SubscriptionFeatures.TenantCrm, new Date(), manager)).enabled) continue;
        const [tenant] = await manager.query<Array<{ timezone: string }>>(`SELECT timezone FROM coffee_shops WHERE id=$1`, [definition.coffeeShopId]);
        if (!tenant) continue;
        const criteria = this.timeCriteria(definition.triggerType, definition.triggerConfig, definition.conditions);
        const [day] = await manager.query<Array<{ localDate: string }>>(`SELECT to_char(clock_timestamp() AT TIME ZONE $1,'YYYY-MM-DD') AS "localDate"`, [tenant.timezone]);
        const candidates = await this.segments.timeAutomationCandidates(manager, definition.coffeeShopId, tenant.timezone,
          definition.id, definition.triggerType as "CLIENT_LAPSED" | "CLIENT_BIRTHDAY", criteria, 100);
        for (const candidate of candidates) {
          const occurrenceAt = definition.triggerType === "CLIENT_BIRTHDAY" ? new Date() : candidate.occurrenceAt;
          await this.insertExecution(manager, definition, { clientId: candidate.clientId, subjectType: "CLIENT", subjectId: candidate.clientId,
            occurrenceKey: candidate.occurrenceKey, triggerData: { occurrenceAt, occurrenceKey: candidate.occurrenceKey,
              timeZone: tenant.timezone, localDate: day?.localDate }, correlationId: crypto.randomUUID(), depth: 0 });
        }
      }
    });
  }

  private async processExecutions(limit: number) {
    for (let i = 0; i < limit; i++) {
      const [execution] = await this.dataSource.query<Row[]>(`WITH candidate AS (
          SELECT id FROM tenant_crm_automation_executions WHERE status='PENDING' AND next_attempt_at<=clock_timestamp()
          ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
        ), claimed AS (UPDATE tenant_crm_automation_executions e SET status='PROCESSING',attempts=attempts+1,
          claimed_at=clock_timestamp(),started_at=COALESCE(started_at,clock_timestamp()),error_code=NULL,error_message=NULL
          FROM candidate c WHERE e.id=c.id RETURNING e.*) SELECT * FROM claimed`);
      if (!execution) break;
      await this.evaluateExecution(execution).catch((error) => this.failExecution(execution, error));
    }
  }

  private async evaluateExecution(execution: Row) {
    await this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query<Row[]>(`SELECT e.*,c.status AS "clientStatus",cs.timezone FROM tenant_crm_automation_executions e
        JOIN clients c ON c.coffee_shop_id=e.coffee_shop_id AND c.id=e.client_id
        JOIN coffee_shops cs ON cs.id=e.coffee_shop_id WHERE e.coffee_shop_id=$1 AND e.id=$2 AND e.status='PROCESSING' FOR UPDATE OF e`,
      [execution.coffee_shop_id, execution.id]);
      if (!current) return;
      if (!(await this.subscriptions.featureState(current.coffee_shop_id, SubscriptionFeatures.TenantCrm, new Date(), manager)).enabled) {
        await this.skipExecution(manager, current.id, "FEATURE_UNAVAILABLE"); return;
      }
      if (current.clientStatus !== "ACTIVE") {
        await this.skipExecution(manager, current.id, "TRIGGER_NO_LONGER_VALID"); return;
      }
      const definition = this.parseJson(current.definition_snapshot);
      const triggerData = this.parseJson(current.trigger_data);
      if (current.trigger_type === "CLIENT_LAPSED" || current.trigger_type === "CLIENT_BIRTHDAY") {
        const stillCurrent = await this.timeOccurrenceCurrent(manager, current, definition, triggerData);
        if (!stillCurrent) { await this.skipExecution(manager, current.id, "TIME_TRIGGER_NO_LONGER_MATCHES"); return; }
      }
      const criteria = current.trigger_type.startsWith("CLIENT_") ? this.timeCriteria(current.trigger_type, definition.triggerConfig, definition.conditions) : definition.conditions;
      const matches = await this.segments.automationCriteriaMatch(manager, current.coffee_shop_id, current.timezone,
        current.client_id, current.trigger_type, criteria, triggerData);
      if (!matches) { await this.skipExecution(manager, current.id, "CONDITIONS_NOT_MET"); return; }
      await manager.query(`UPDATE tenant_crm_automation_executions SET conditions_evaluated_at=clock_timestamp(),claimed_at=NULL WHERE coffee_shop_id=$1 AND id=$2`,
      [current.coffee_shop_id, current.id]);
    });
  }

  private async timeOccurrenceCurrent(manager: EntityManager, execution: Row, definition: Row, triggerData: Row) {
    if (execution.trigger_type === "CLIENT_BIRTHDAY") {
      const [today] = await manager.query<Array<{ localDate: string; monthDay: string }>>(`SELECT to_char(clock_timestamp() AT TIME ZONE $1,'YYYY-MM-DD') AS "localDate",
        to_char(clock_timestamp() AT TIME ZONE $1,'MM-DD') AS "monthDay"`, [execution.timezone]);
      if (!today || today.localDate !== triggerData.localDate) return false;
      const rows = await manager.query<Array<{ birthdayMonthDay: string | null }>>(`SELECT birthday_month_day AS "birthdayMonthDay"
        FROM tenant_crm_client_profiles WHERE coffee_shop_id=$1 AND client_id=$2`, [execution.coffee_shop_id, execution.client_id]);
      return rows[0]?.birthdayMonthDay === today.monthDay;
    }
    const [current] = await manager.query<Array<{ occurrenceKey: string | null }>>(`SELECT CASE WHEN MAX(COALESCE(status_changed_at,created_at)) IS NULL THEN NULL
      ELSE 'LAPSED:'||$2::uuid::text||':'||floor(extract(epoch FROM MAX(COALESCE(status_changed_at,created_at)))*1000)::bigint::text END AS "occurrenceKey"
      FROM orders WHERE coffee_shop_id=$1 AND client_id=$2 AND status='DELIVERED'`, [execution.coffee_shop_id, execution.client_id]);
    if (!current?.occurrenceKey || current.occurrenceKey !== triggerData.occurrenceKey) return false;
    const criteria = this.timeCriteria("CLIENT_LAPSED", definition.triggerConfig, definition.conditions);
    return this.segments.automationCriteriaMatch(manager, execution.coffee_shop_id, execution.timezone,
      execution.client_id, "CLIENT_LAPSED", criteria, triggerData);
  }

  private async skipExecution(manager: EntityManager, id: string, reason: string) {
    await manager.query(`UPDATE tenant_crm_automation_executions SET status='SKIPPED',error_code=$2,error_message='Automation execution was skipped.',
      claimed_at=NULL,completed_at=clock_timestamp() WHERE id=$1`, [id, reason]);
    await manager.query(`UPDATE tenant_crm_automation_actions SET status='SKIPPED',claimed_at=NULL,completed_at=clock_timestamp()
      WHERE automation_execution_id=$1 AND status IN ('PENDING','PROCESSING')`, [id]);
  }

  private async failExecution(execution: Row, error: unknown) {
    const mapped = automationError(error, "Automation conditions could not be evaluated.");
    const terminal = !mapped.retryable || Number(execution.attempts) >= AUTOMATION_MAX_ATTEMPTS;
    const driverCode = (error as { driverError?: { code?: string }; code?: string } | null)?.driverError?.code ??
      (error as { code?: string } | null)?.code;
    await this.dataSource.query(`UPDATE tenant_crm_automation_executions SET status=$2,claimed_at=NULL,
      next_attempt_at=clock_timestamp()+($3::int*interval '1 millisecond'),failed_at=CASE WHEN $6::boolean THEN clock_timestamp() ELSE NULL END,
      error_code=$4,error_message=$5 WHERE id=$1 AND status='PROCESSING' AND conditions_evaluated_at IS NULL`,
    [execution.id, terminal ? "FAILED" : "PENDING", automationRetryDelay(Number(execution.attempts)), mapped.code, mapped.message, terminal]);
    this.logger.warn(`Tenant CRM automation execution ${execution.id} failed (${mapped.code}${driverCode ? `; database ${driverCode}` : ""})`);
  }

  private async processActions(limit: number) {
    for (let i = 0; i < limit; i++) {
      const [action] = await this.dataSource.query<Row[]>(`WITH candidate AS (
        SELECT a.id FROM tenant_crm_automation_actions a JOIN tenant_crm_automation_executions e
          ON e.coffee_shop_id=a.coffee_shop_id AND e.id=a.automation_execution_id
        WHERE a.status='PENDING' AND a.next_attempt_at<=clock_timestamp() AND e.status='PROCESSING' AND e.conditions_evaluated_at IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM tenant_crm_automation_actions previous WHERE previous.coffee_shop_id=a.coffee_shop_id
            AND previous.automation_execution_id=a.automation_execution_id AND previous.action_index<a.action_index AND previous.status<>'SUCCEEDED')
        ORDER BY e.created_at,a.action_index FOR UPDATE OF a SKIP LOCKED LIMIT 1
      ), claimed AS (UPDATE tenant_crm_automation_actions a SET status='PROCESSING',attempts=attempts+1,claimed_at=clock_timestamp(),
        started_at=COALESCE(started_at,clock_timestamp()),error_code=NULL,error_message=NULL FROM candidate c WHERE a.id=c.id RETURNING a.*)
      SELECT a.*,e.client_id AS "clientId",e.coffee_shop_id AS "coffeeShopId",e.id AS "automationExecutionId",e.correlation_id AS "correlationId",
        e.automation_depth AS "depth",e.created_at AS "executionCreatedAt",cs.timezone
      FROM claimed a JOIN tenant_crm_automation_executions e ON e.coffee_shop_id=a.coffee_shop_id AND e.id=a.automation_execution_id
      JOIN coffee_shops cs ON cs.id=e.coffee_shop_id`);
      if (!action) break;
      await this.executeAction(action).catch((error) => this.failAction(action, error));
    }
  }

  private async executeAction(action: Row) {
    await this.dataSource.transaction(async (manager) => {
      const [current] = await manager.query<Row[]>(`SELECT a.id,e.id AS "automationExecutionId",e.client_id AS "clientId",e.coffee_shop_id AS "coffeeShopId",
        e.correlation_id AS "correlationId",e.automation_depth AS depth,e.created_at AS "executionCreatedAt",cs.timezone
        FROM tenant_crm_automation_actions a JOIN tenant_crm_automation_executions e
        ON e.coffee_shop_id=a.coffee_shop_id AND e.id=a.automation_execution_id JOIN coffee_shops cs ON cs.id=e.coffee_shop_id
        WHERE a.coffee_shop_id=$1 AND a.id=$2 AND a.status='PROCESSING' FOR UPDATE OF a`, [action.coffee_shop_id, action.id]);
      if (!current) return;
      const [execution] = await manager.query<Array<{ status: string; conditionsEvaluatedAt: Date | null }>>(`SELECT status,conditions_evaluated_at AS "conditionsEvaluatedAt"
        FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [current.coffeeShopId, action.automation_execution_id]);
      if (execution?.status !== "PROCESSING" || !execution.conditionsEvaluatedAt) return;
      if (!(await this.subscriptions.featureState(current.coffeeShopId, SubscriptionFeatures.TenantCrm, new Date(), manager)).enabled) {
        await this.skipExecution(manager, action.automation_execution_id, "FEATURE_UNAVAILABLE"); return;
      }
      await manager.query(`SELECT set_config('ucafe.tenant_crm_automation_execution_id',$1,true),
        set_config('ucafe.tenant_crm_automation_correlation_id',$2,true),set_config('ucafe.tenant_crm_automation_depth',$3,true)`,
      [current.automationExecutionId, current.correlationId, String(Math.min(AUTOMATION_MAX_DEPTH, Number(current.depth) + 1))]);
      const config = this.parseJson(action.config);
      let result: Row;
      if (action.action_type === "ADD_TAG" || action.action_type === "REMOVE_TAG") {
        result = await this.crm.applyAutomationTag(manager, current.coffeeShopId, current.clientId, config.tagId, action.id, action.action_type === "ADD_TAG");
      } else if (action.action_type === "ADD_NOTE") {
        result = await this.crm.createAutomationNote(manager, current.coffeeShopId, current.clientId, action.id, config.body);
      } else {
        const [due] = await manager.query<Array<{ dueAt: Date }>>(`SELECT (((($1::timestamptz AT TIME ZONE $2) + ($3::int*interval '1 day')) AT TIME ZONE $2)) AS "dueAt"`,
        [current.executionCreatedAt, current.timezone, config.dueInDays]);
        if (!due) throw new TenantCrmAutomationError("INVALID_REMINDER_DUE_DATE", "Automation reminder due date could not be calculated.");
        result = await this.crm.createAutomationReminder(manager, current.coffeeShopId, current.clientId, action.id,
          { title: config.title, description: config.description ?? null, dueAt: due.dueAt, assignedToUserId: config.assignedToUserId ?? null });
      }
      await manager.query(`UPDATE tenant_crm_automation_actions SET status='SUCCEEDED',claimed_at=NULL,completed_at=clock_timestamp(),
        result_metadata=$3::jsonb,error_code=NULL,error_message=NULL WHERE coffee_shop_id=$1 AND id=$2`,
      [current.coffeeShopId, action.id, JSON.stringify(result)]);
    });
  }

  private async failAction(action: Row, error: unknown) {
    const mapped = automationError(error, "Automation action could not be completed.");
    const terminal = !mapped.retryable || Number(action.attempts) >= AUTOMATION_MAX_ATTEMPTS;
    const driverCode = (error as { driverError?: { code?: string }; code?: string } | null)?.driverError?.code ??
      (error as { code?: string } | null)?.code;
    await this.dataSource.query(`UPDATE tenant_crm_automation_actions SET status=$3,claimed_at=NULL,
      next_attempt_at=clock_timestamp()+($4::int*interval '1 millisecond'),completed_at=CASE WHEN $7::boolean THEN clock_timestamp() ELSE NULL END,
      error_code=$5,error_message=$6 WHERE coffee_shop_id=$1 AND id=$2 AND status='PROCESSING'`,
    [action.coffee_shop_id, action.id, terminal ? "FAILED" : "PENDING", automationRetryDelay(Number(action.attempts)), mapped.code, mapped.message, terminal]);
    this.logger.warn(`Tenant CRM automation action ${action.id} failed (${mapped.code}${driverCode ? `; database ${driverCode}` : ""})`);
  }

  private async finishExecutions() {
    await this.dataSource.query(`UPDATE tenant_crm_automation_executions e SET status=CASE WHEN EXISTS(
        SELECT 1 FROM tenant_crm_automation_actions a WHERE a.coffee_shop_id=e.coffee_shop_id AND a.automation_execution_id=e.id AND a.status='FAILED')
      THEN 'FAILED' ELSE 'SUCCEEDED' END,completed_at=clock_timestamp(),failed_at=CASE WHEN EXISTS(
        SELECT 1 FROM tenant_crm_automation_actions a WHERE a.coffee_shop_id=e.coffee_shop_id AND a.automation_execution_id=e.id AND a.status='FAILED')
      THEN clock_timestamp() ELSE NULL END,claimed_at=NULL
      WHERE e.status='PROCESSING' AND e.conditions_evaluated_at IS NOT NULL AND NOT EXISTS(
        SELECT 1 FROM tenant_crm_automation_actions a WHERE a.coffee_shop_id=e.coffee_shop_id AND a.automation_execution_id=e.id AND a.status IN ('PENDING','PROCESSING'))`);
  }

  private async insertExecution(manager: EntityManager, definition: Definition, input: { clientId: string; subjectType: string; subjectId: string;
    sourceEventId?: string; causationExecutionId?: string | null; occurrenceKey: string; triggerData: Row; correlationId: string; depth: number; loopBlocked?: boolean }) {
    if (!input.clientId) return;
    const loopBlocked = input.loopBlocked === true || input.depth >= AUTOMATION_MAX_DEPTH;
    const snapshot = { id: definition.id, name: definition.name, description: definition.description, version: definition.version,
      triggerType: definition.triggerType, triggerConfig: definition.triggerConfig, conditions: definition.conditions, actions: definition.actions };
    const rows = await manager.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_automation_executions
      (coffee_shop_id,automation_id,source_event_id,client_id,trigger_type,subject_type,subject_id,occurrence_key,automation_version,
       definition_snapshot,trigger_data,status,correlation_id,automation_depth,causation_execution_id,error_code,error_message,completed_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15,$16,$17,CASE WHEN $18::boolean THEN clock_timestamp() END)
      ON CONFLICT DO NOTHING RETURNING id`,
    [definition.coffeeShopId, definition.id, input.sourceEventId ?? null, input.clientId, definition.triggerType, input.subjectType,
      input.subjectId, input.occurrenceKey, definition.version, JSON.stringify(snapshot), JSON.stringify(input.triggerData),
      loopBlocked ? "LOOP_BLOCKED" : "PENDING", input.correlationId, Math.min(input.depth, AUTOMATION_MAX_DEPTH),
      input.causationExecutionId ?? null, loopBlocked ? "AUTOMATION_REENTRY" : null,
      loopBlocked ? "Automation stopped to prevent a causal loop." : null, loopBlocked]);
    if (!rows[0]) return;
    for (const [actionIndex, action] of definition.actions.entries()) await manager.query(`INSERT INTO tenant_crm_automation_actions
      (coffee_shop_id,automation_execution_id,action_index,action_type,config,status,completed_at)
      VALUES($1,$2,$3,$4,$5::jsonb,$6,CASE WHEN $7::boolean THEN clock_timestamp() END)`, [definition.coffeeShopId, rows[0].id, actionIndex, action.type,
      JSON.stringify(action.config), loopBlocked ? "SKIPPED" : "PENDING", loopBlocked]);
  }

  private async eventData(manager: EntityManager, coffeeShopId: string, subjectId: string, trigger: TenantCrmAutomationTrigger, payload: Row) {
    if (trigger.startsWith("FEEDBACK_")) {
      return { feedback: { feedbackId: subjectId, rating: payload.rating, source: payload.source } };
    }
    return { order: { orderId: subjectId, totalAmountToman: payload.totalAmountToman, deliveryMethod: payload.deliveryMethod } };
  }

  private async isCausalLoop(manager: EntityManager, coffeeShopId: string, causationId: string | null, automationId: string) {
    if (!causationId) return false;
    const rows = await manager.query<Array<{ found: boolean }>>(`WITH RECURSIVE ancestors AS (
      SELECT id,automation_id,causation_execution_id FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND id=$2
      UNION ALL SELECT parent.id,parent.automation_id,parent.causation_execution_id FROM tenant_crm_automation_executions parent
        JOIN ancestors child ON parent.coffee_shop_id=$1 AND parent.id=child.causation_execution_id
    ) SELECT EXISTS(SELECT 1 FROM ancestors WHERE automation_id=$3) AS found`, [coffeeShopId, causationId, automationId]);
    return Boolean(rows[0]?.found);
  }

  // ponytail: one global scan lock, 100 active time automations and 100 clients each; shard by tenant after measured contention.
  private timeCriteria(trigger: TenantCrmAutomationTrigger, config: Row, conditions: unknown) {
    if (conditions != null && (!this.isRecord(conditions) || conditions.type !== "group"))
      throw new BadRequestException("Time-trigger conditions must be a Phase 4 criteria group");
    const base = trigger === "CLIENT_LAPSED" ? [
      { type: "condition", field: "client.status", operator: "equals", value: "ACTIVE" },
      { type: "condition", field: "order.deliveredCount", operator: "greater_or_equal", value: 1 },
      { type: "condition", field: "order.lastDeliveredAt", operator: "older_than", value: config.days },
    ] : [
      { type: "condition", field: "client.status", operator: "equals", value: "ACTIVE" },
      { type: "condition", field: "crm.birthdayMonthDay", operator: "today" },
    ];
    return { type: "group", version: 1, operator: "AND", conditions: [...base,
      ...(conditions ? [conditions] : [])] };
  }

  private async validateDefinition(coffeeShopId: string, timeZone: string, definition: Omit<Definition, "id" | "coffeeShopId" | "version" | "activatedAt" | "status">) {
    definition.triggerConfig = this.validateTriggerConfig(definition.triggerType, definition.triggerConfig);
    if (!Array.isArray(definition.actions) || definition.actions.length < 1 || definition.actions.length > 10) throw new BadRequestException("An automation needs 1 to 10 actions");
    for (const action of definition.actions) this.validateActionConfig(action.type, action.config);
    const criteria = definition.triggerType.startsWith("CLIENT_") ? await this.timeCriteria(definition.triggerType, definition.triggerConfig, definition.conditions) : definition.conditions;
    await this.segments.validateAutomationCriteria(coffeeShopId, timeZone, definition.triggerType, criteria);
    for (const action of definition.actions) {
      const config = action.config;
      if (config.tagId) {
        const [tag] = await this.dataSource.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_tags WHERE coffee_shop_id=$1 AND id=$2 AND archived_at IS NULL`, [coffeeShopId, config.tagId]);
        if (!tag) throw new BadRequestException("Every tag action needs an active tag from this café");
      }
      if (config.assignedToUserId) {
        const [user] = await this.dataSource.query<Array<{ id: string }>>(`SELECT m.user_id AS id FROM coffee_shop_memberships m JOIN users u ON u.id=m.user_id
          WHERE m.coffee_shop_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND u.status='ACTIVE' AND u.deleted_at IS NULL`, [coffeeShopId, config.assignedToUserId]);
        if (!user) throw new BadRequestException("Reminder assignees must be active members of this café");
      }
    }
  }

  private definitionInput(input: CreateTenantCrmAutomationDto): any {
    return { name: input.name?.trim(), description: input.description?.trim() || null, triggerType: input.triggerType,
      triggerConfig: input.triggerConfig ?? {}, conditions: input.conditions ?? null, actions: input.actions };
  }

  private validateTriggerConfig(trigger: TenantCrmAutomationTrigger, config: Record<string, unknown>) {
    const keys = trigger === "CLIENT_LAPSED" ? ["days"] : [];
    if (!this.isRecord(config) || Object.keys(config).some((key) => !keys.includes(key))) throw new BadRequestException("Unsupported trigger configuration");
    if (trigger === "CLIENT_LAPSED" && (!Number.isInteger(config.days) || Number(config.days) < 1 || Number(config.days) > 3650))
      throw new BadRequestException("Lapsed-customer days must be between 1 and 3650");
    return config;
  }

  private validateActionConfig(type: TenantCrmAutomationAction, config: Record<string, unknown>) {
    if (!this.isRecord(config)) throw new BadRequestException("Action configuration must be an object");
    const allowed: Record<TenantCrmAutomationAction, string[]> = {
      ADD_TAG: ["tagId"], REMOVE_TAG: ["tagId"], ADD_NOTE: ["body"], CREATE_REMINDER: ["title", "description", "dueInDays", "assignedToUserId"],
    };
    if (Object.keys(config).some((key) => !allowed[type].includes(key))) throw new BadRequestException("Unsupported action configuration");
    if (type === "ADD_TAG" || type === "REMOVE_TAG") {
      if (typeof config.tagId !== "string" || !/^[0-9a-f-]{36}$/i.test(config.tagId)) throw new BadRequestException("Choose a tag");
    } else if (type === "ADD_NOTE") {
      if (typeof config.body !== "string" || !config.body.trim() || config.body.length > 1000) throw new BadRequestException("A note must contain 1 to 1000 characters");
    } else if (typeof config.title !== "string" || !config.title.trim() || config.title.length > 120 ||
      !Number.isInteger(config.dueInDays) || Number(config.dueInDays) < 0 || Number(config.dueInDays) > 3650 ||
      config.description != null && (typeof config.description !== "string" || config.description.length > 500) ||
      config.assignedToUserId != null && (typeof config.assignedToUserId !== "string" || !/^[0-9a-f-]{36}$/i.test(config.assignedToUserId)))
      throw new BadRequestException("Reminder title, due date offset, description, or assignee is invalid");
  }

  private async getDefinition(executor: DataSource | EntityManager, coffeeShopId: string, automationId: string): Promise<Definition> {
    const rows = await executor.query<Definition[]>(`SELECT ${this.definitionColumns()} FROM tenant_crm_automations WHERE coffee_shop_id=$1 AND id=$2`, [coffeeShopId, automationId]);
    if (!rows[0]) throw new NotFoundException("Automation not found");
    return this.parseJson(rows[0]) as Definition;
  }

  private definitionColumns() {
    return `id,coffee_shop_id AS "coffeeShopId",name,description,status,trigger_type AS "triggerType",trigger_config AS "triggerConfig",
      conditions,actions,version,activated_at AS "activatedAt"`;
  }
  private selectAutomationSql() { return `SELECT ${this.definitionColumns()},created_at AS "createdAt",updated_at AS "updatedAt" FROM tenant_crm_automations`; }
  private executionSelectSql() { return `SELECT e.id,e.automation_id AS "automationId",e.source_event_id AS "sourceEventId",e.client_id AS "clientId",
    c.first_name AS "clientFirstName",c.last_name AS "clientLastName",e.trigger_type AS "triggerType",e.subject_type AS "subjectType",
    e.subject_id AS "subjectId",e.occurrence_key AS "occurrenceKey",e.automation_version AS "automationVersion",e.definition_snapshot AS "definitionSnapshot",
    e.trigger_data AS "triggerData",e.status,e.attempts,e.started_at AS "startedAt",e.completed_at AS "completedAt",e.failed_at AS "failedAt",
    e.error_code AS "errorCode",e.error_message AS "errorMessage",e.created_at AS "createdAt"
    FROM tenant_crm_automation_executions e JOIN clients c ON c.coffee_shop_id=e.coffee_shop_id AND c.id=e.client_id`; }
  private parseJson<T = any>(value: T): any {
    if (typeof value === "string") { try { return JSON.parse(value); } catch { return value; } }
    return value;
  }
  private isRecord(value: unknown): value is Record<string, any> { return typeof value === "object" && value !== null && !Array.isArray(value); }
}
