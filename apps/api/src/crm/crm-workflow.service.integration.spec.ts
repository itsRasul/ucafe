import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmDealService } from "./crm-deal.service";
import { CrmTaskService } from "./crm-task.service";
import { CrmFilterService } from "./crm-filter.service";
import { CrmMetadataService } from "./crm-metadata.service";
import { CrmWorkflowService } from "./crm-workflow.service";
import { CrmWorkflowEventService } from "./crm-workflow-event.service";
import { CrmWorkflowRuntimeService } from "./crm-workflow-runtime.service";
import { CrmService } from "./crm.service";
import { CrmLeadSource } from "./entities/crm-lead.entity";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;

function recoveryHarness(eventResult: [Array<Record<string, unknown>>, number], actionResult: [Array<Record<string, unknown>>, number]) {
  const calls: Array<{ query: string; parameters?: unknown[] }> = [];
  const warnings: string[] = [];
  type ManagerStub = { query: (query: string, parameters?: unknown[]) => Promise<unknown> };
  const manager: ManagerStub = {
    query: async (query: string, parameters?: unknown[]) => {
      calls.push({ query, parameters });
      if (query.includes("UPDATE crm_workflow_events")) return eventResult;
      if (query.includes("UPDATE crm_workflow_action_executions")) return actionResult;
      return [];
    },
  };
  const dataSource = {
    transaction: async <T>(run: (manager: ManagerStub) => Promise<T>) => run(manager),
  } as unknown as DataSource;
  const runtime = new CrmWorkflowRuntimeService(dataSource, {} as CrmWorkflowService, {} as CrmWorkflowEventService,
    {} as CrmLeadService, {} as CrmDealService, {} as CrmTaskService, {} as CrmMetadataService);
  Object.defineProperty(runtime, "logger", { configurable: true, value: { warn: (message: string) => warnings.push(message) } });
  return { runtime, calls, warnings };
}

test("workflow stale recovery reads TypeORM UPDATE RETURNING rows, not its [rows, rowCount] wrapper", async () => {
  const empty = recoveryHarness([[], 0], [[], 0]);
  await (empty.runtime as unknown as { recoverStaleWork(): Promise<void> }).recoverStaleWork();
  assert.deepEqual(empty.warnings, [], "zero recovered rows must not produce a warning");

  const recovered = recoveryHarness([[{ id: "event-1", eventType: "LEAD_CREATED", attempt: 1, status: "PENDING" }], 1], [[], 0]);
  await (recovered.runtime as unknown as { recoverStaleWork(): Promise<void> }).recoverStaleWork();
  assert.equal(recovered.warnings.length, 1);
  assert.match(recovered.warnings[0]!, /event-1\/LEAD_CREATED attempt=1 status=PENDING/);
});

test("stale action recovery reconciles failed and retrying WorkflowExecution states", async () => {
  const recovered = recoveryHarness([[], 0], [[
    { workflow_execution_id: "execution-retry", status: "RETRYING" },
    { workflow_execution_id: "execution-failed", status: "FAILED" },
  ], 2]);
  await (recovered.runtime as unknown as { recoverStaleWork(): Promise<void> }).recoverStaleWork();
  const executionUpdates = recovered.calls.filter(({ query }) => query.includes("UPDATE crm_workflow_executions"));
  assert.deepEqual(executionUpdates.map(({ parameters }) => parameters), [["execution-failed"], ["execution-retry"]]);
  assert.match(executionUpdates[0]!.query, /status='FAILED'/);
  assert.match(executionUpdates[1]!.query, /status='RETRYING'/);
});

test("workflow replay and manual retry do not duplicate executions or completed CRM actions", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const workflowEvents = new CrmWorkflowEventService();
  let actorId = "";
  let workflowId = "";
  let conditionFalseWorkflowId = "";
  let leadId = "";
  let tagId = "";
  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>(`SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
      JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE upr.user_id=u.id AND p.key='crm.manage') ORDER BY u.created_at LIMIT 1`);
    assert.ok(actors[0], "Workflow integration test requires a platform CRM manager");
    actorId = actors[0].id;
    const filters = new CrmFilterService(dataSource);
    const crypto = new AuthCryptoService(new ConfigService({ AUTH_PEPPER: "crm-workflow-test-pepper-value-long-enough", PII_ENCRYPTION_KEY: Buffer.alloc(32, 17).toString("base64") }));
    const leads = new CrmLeadService(dataSource, crypto, filters, undefined, workflowEvents);
    const deals = new CrmDealService(dataSource, leads, filters, workflowEvents);
    const tasksService = new CrmTaskService(dataSource, leads, workflowEvents);
    const metadata = new CrmMetadataService(dataSource);
    const workflows = new CrmWorkflowService(dataSource, filters, leads);
    const runtime = new CrmWorkflowRuntimeService(dataSource, workflows, workflowEvents, leads, deals, tasksService, metadata);
    const tag = await metadata.createTag({ name: `Workflow test ${randomUUID()}` }, actorId);
    tagId = tag.id;
    const created = await workflows.create({
      name: `Workflow integration ${randomUUID()}`, triggerType: "LEAD_CREATED", conditionEntityType: "LEAD",
      conditions: { version: 1, logic: "AND", conditions: [{ field: "status", operator: "is", value: "NEW" }] }, enabled: true,
      actions: [
        { type: "ADD_TAG", config: { recordType: "LEAD", tagId } },
        { type: "ASSIGN_LEAD_OWNER", config: { userId: actorId } },
        { type: "CREATE_TASK", config: { recordType: "LEAD", title: "Automated integration follow-up", dueInDays: 1, assigneeStrategy: "UNASSIGNED", userId: null } },
      ],
    }, actorId);
    workflowId = created.id;
    const lead = await leads.create({ businessName: `Workflow test ${randomUUID()}`, source: CrmLeadSource.Manual }, actorId);
    leadId = lead.id;
    const original = (await dataSource.query<Array<{ id: string; source_key: string; event_context: Record<string, unknown> }>>(
      "SELECT id,source_key,event_context FROM crm_workflow_events WHERE event_type='LEAD_CREATED' AND subject_id=$1 ORDER BY created_at DESC LIMIT 1", [leadId]))[0];
    assert.ok(original, "Lead creation must write its trigger event in the same transaction");
    assert.equal((await workflows.get(workflowId)).valid, true, "stored Workflow definition must remain valid before matching its event");

    await runtime.process();
    await workflowEvents.record(dataSource.manager, { eventType: "LEAD_CREATED", subjectType: "LEAD", subjectId: leadId, sourceKey: original.source_key, eventContext: original.event_context });
    const tagRepeat = await dataSource.transaction((manager) => metadata.applyWorkflowTag(manager, CrmCustomFieldEntityType.Lead, leadId, tagId, true));
    await runtime.process();

    const executions = await dataSource.query<Array<{ id: string; status: string }>>("SELECT id,status FROM crm_workflow_executions WHERE workflow_id=$1", [workflowId]);
    assert.equal(executions.length, 1);
    const failureDetails = await dataSource.query(`SELECT e.error_code,e.error_message,a.action_index,a.status AS action_status,a.error_code AS action_error_code
      FROM crm_workflow_executions e LEFT JOIN crm_workflow_action_executions a ON a.workflow_execution_id=e.id WHERE e.workflow_id=$1 ORDER BY a.action_index`, [workflowId]);
    assert.equal(executions[0]?.status, "SUCCEEDED", JSON.stringify(failureDetails));
    const actionResults = await dataSource.query<Array<{ action_index: number; status: string; manual_retry_count: number }>>(`
      SELECT a.action_index,a.status,a.manual_retry_count FROM crm_workflow_action_executions a
      JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1 ORDER BY a.action_index`, [workflowId]);
    assert.deepEqual(actionResults.map(({ action_index, status }) => [action_index, status]), [[0, "SUCCEEDED"], [1, "SUCCEEDED"], [2, "SUCCEEDED"]]);
    assert.equal(Number(actionResults[0]?.manual_retry_count), 0);
    assert.equal(tagRepeat.changed, false, "adding a tag that is already assigned is a no-op");
    const tagAssignments = await dataSource.query<Array<{ total: number }>>("SELECT count(*)::int AS total FROM crm_entity_tags WHERE tag_id=$1 AND lead_id=$2", [tagId, leadId]);
    assert.equal(tagAssignments[0]?.total, 1);
    const createdTasks = await dataSource.query<Array<{ automation_action_execution_id: string; created_by_user_id: string | null }>>(`
      SELECT t.automation_action_execution_id,t.created_by_user_id FROM crm_tasks t
      JOIN crm_workflow_action_executions a ON a.id=t.automation_action_execution_id
      JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1 AND t.lead_id=$2`, [workflowId, leadId]);
    assert.equal(createdTasks.length, 1);
    assert.equal(createdTasks[0]?.created_by_user_id, null);
    const assignedLead = await dataSource.query<Array<{ owner_id: string }>>("SELECT owner_id FROM crm_leads WHERE id=$1", [leadId]);
    assert.equal(assignedLead[0]?.owner_id, actorId);

    await dataSource.query(`UPDATE crm_workflow_action_executions SET status='FAILED',completed_at=now()
      WHERE workflow_execution_id=$1 AND action_index=1`, [executions[0]!.id]);
    await dataSource.query(`UPDATE crm_workflow_action_executions SET status='PENDING',completed_at=NULL
      WHERE workflow_execution_id=$1 AND action_index=2`, [executions[0]!.id]);
    await dataSource.query(`DELETE FROM crm_tasks WHERE automation_action_execution_id IN (
      SELECT id FROM crm_workflow_action_executions WHERE workflow_execution_id=$1 AND action_index=2)`, [executions[0]!.id]);
    await dataSource.query("UPDATE crm_workflow_executions SET status='FAILED',failed_at=now() WHERE id=$1", [executions[0]!.id]);
    await runtime.process();
    const stopped = await dataSource.query<Array<{ status: string; action_status: string }>>(`
      SELECT e.status,a.status AS action_status FROM crm_workflow_executions e JOIN crm_workflow_action_executions a ON a.workflow_execution_id=e.id
      WHERE e.id=$1 AND a.action_index=2`, [executions[0]!.id]);
    assert.deepEqual([stopped[0]?.status, stopped[0]?.action_status], ["FAILED", "PENDING"], "an action after a failure remains stopped");
    await workflows.retryExecution(executions[0]!.id, actorId);
    await runtime.process();
    const afterRetry = await dataSource.query<Array<{ status: string; manual_retry_count: number }>>(`
      SELECT e.status,a.manual_retry_count FROM crm_workflow_executions e JOIN crm_workflow_action_executions a ON a.workflow_execution_id=e.id
      WHERE e.id=$1 AND a.action_index=1`, [executions[0]!.id]);
    assert.equal(afterRetry[0]?.status, "SUCCEEDED");
    assert.equal(Number(afterRetry[0]?.manual_retry_count), 1);
    const tasksAfterRetry = await dataSource.query<Array<{ total: number }>>(`
      SELECT count(*)::int AS total FROM crm_tasks t JOIN crm_workflow_action_executions a ON a.id=t.automation_action_execution_id
      JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1 AND t.lead_id=$2`, [workflowId, leadId]);
    assert.equal(tasksAfterRetry[0]?.total, 1, "retrying a failed earlier action does not repeat the completed Task");

    const falseWorkflow = await workflows.create({
      name: `Workflow condition miss ${randomUUID()}`, triggerType: "LEAD_CREATED", conditionEntityType: "LEAD",
      conditions: { version: 1, logic: "AND", conditions: [{ field: "status", operator: "is", value: "CONVERTED" }] }, enabled: true,
      actions: [{ type: "ADD_TAG", config: { recordType: "LEAD", tagId } }],
    }, actorId);
    conditionFalseWorkflowId = falseWorkflow.id;
    const conditionMiss = (await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,record_context,target_workflow_id,correlation_id)
      VALUES($1,'LEAD_CREATED','LEAD',$2::uuid,jsonb_build_object('leadId',$2::text),$3,$4) RETURNING id
    `, [`condition-miss:${randomUUID()}`, leadId, conditionFalseWorkflowId, randomUUID()]))[0]!;
    const runtimeReplica = new CrmWorkflowRuntimeService(dataSource, workflows, workflowEvents, leads, deals, tasksService, metadata);
    await Promise.all([runtime.process(), runtimeReplica.process()]);
    const conditionMissState = (await dataSource.query<Array<{ status: string; attempts: number; executions: number }>>(`
      SELECT e.status,e.attempt AS attempts,(SELECT count(*)::int FROM crm_workflow_executions x WHERE x.event_id=e.id) AS executions
      FROM crm_workflow_events e WHERE e.id=$1`, [conditionMiss.id]))[0]!;
    assert.deepEqual(conditionMissState, { status: "PROCESSED", attempts: 1, executions: 0 });

    const healthySlow = (await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,record_context,target_workflow_id,correlation_id,status,attempt,claimed_at)
      VALUES($1,'TRIAL_ENDING','LEAD',$2::uuid,jsonb_build_object('leadId',$2::text),$3,$4,'PROCESSING',1,now()-interval '4 minutes') RETURNING id
    `, [`healthy-slow:${randomUUID()}`, leadId, workflowId, randomUUID()]))[0]!;
    await runtime.process();
    const healthySlowState = (await dataSource.query<Array<{ status: string; attempt: number }>>("SELECT status,attempt FROM crm_workflow_events WHERE id=$1", [healthySlow.id]))[0]!;
    assert.deepEqual(healthySlowState, { status: "PROCESSING", attempt: 1 }, "a claim younger than the five-minute stale threshold remains owned");

    const staleNoMatch = (await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,record_context,target_workflow_id,correlation_id,status,attempt,claimed_at)
      VALUES($1,'TRIAL_ENDING','LEAD',$2::uuid,jsonb_build_object('leadId',$2::text),$3,$4,'PROCESSING',1,now()-interval '6 minutes') RETURNING id
    `, [`stale-no-match:${randomUUID()}`, leadId, workflowId, randomUUID()]))[0]!;
    const exhausted = (await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,record_context,target_workflow_id,correlation_id,status,attempt,claimed_at)
      VALUES($1,'TRIAL_ENDING','LEAD',$2::uuid,jsonb_build_object('leadId',$2::text),$3,$4,'PROCESSING',3,now()-interval '6 minutes') RETURNING id
    `, [`stale-exhausted:${randomUUID()}`, leadId, workflowId, randomUUID()]))[0]!;
    await runtime.process();
    const staleStates = await dataSource.query<Array<{ id: string; status: string; attempt: number; error_code: string | null; claim_released: boolean }>>(`
      SELECT id,status,attempt,error_code,claimed_at IS NULL AS claim_released FROM crm_workflow_events WHERE id=ANY($1::uuid[])
    `, [[staleNoMatch.id, exhausted.id]]);
    assert.deepEqual(staleStates.sort((a, b) => a.id.localeCompare(b.id)), [
      { id: staleNoMatch.id, status: "PROCESSED", attempt: 2, error_code: null, claim_released: true },
      { id: exhausted.id, status: "FAILED", attempt: 3, error_code: "EVENT_RETRIES_EXHAUSTED", claim_released: true },
    ].sort((a, b) => a.id.localeCompare(b.id)));
    await runtime.process();
    const stillTerminal = await dataSource.query<Array<{ status: string; attempt: number }>>("SELECT status,attempt FROM crm_workflow_events WHERE id=$1", [exhausted.id]);
    assert.deepEqual(stillTerminal[0], { status: "FAILED", attempt: 3 }, "terminal stale events are not recovered again");
  } finally {
    if (dataSource.isInitialized) {
      if (workflowId) {
        await dataSource.query("DELETE FROM crm_tasks WHERE automation_action_execution_id IN (SELECT a.id FROM crm_workflow_action_executions a JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1)", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_action_executions WHERE workflow_execution_id IN (SELECT id FROM crm_workflow_executions WHERE workflow_id=$1)", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_executions WHERE workflow_id=$1", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_events WHERE target_workflow_id=$1 OR subject_id=$2", [workflowId, leadId || null]);
      await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [[workflowId, tagId]]);
      await dataSource.query("DELETE FROM crm_workflows WHERE id=$1", [workflowId]);
    }
    if (conditionFalseWorkflowId && dataSource.isInitialized) await dataSource.query("DELETE FROM crm_workflows WHERE id=$1", [conditionFalseWorkflowId]);
    if (tagId && dataSource.isInitialized) {
      await dataSource.query("DELETE FROM crm_entity_tags WHERE tag_id=$1", [tagId]);
      await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=$1", [tagId]);
      await dataSource.query("DELETE FROM crm_tags WHERE id=$1", [tagId]);
    }
      if (leadId) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=$1", [leadId]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=$1", [leadId]);
      }
      await dataSource.destroy();
    }
  }
});

test("Trial-ending scanner emits one stable event and leaves Subscription state unchanged", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const workflowEvents = new CrmWorkflowEventService();
  let actorId = "";
  let workflowId = "";
  let organizationId = "";
  let tenantId = "";
  let subscriptionId = "";
  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>(`SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
      JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE upr.user_id=u.id AND p.key='crm.manage') ORDER BY u.created_at LIMIT 1`);
    assert.ok(actors[0], "Trial Workflow integration test requires a platform CRM manager");
    actorId = actors[0].id;
    const filters = new CrmFilterService(dataSource);
    const crypto = new AuthCryptoService(new ConfigService({ AUTH_PEPPER: "crm-trial-workflow-test-pepper-long-enough", PII_ENCRYPTION_KEY: Buffer.alloc(32, 23).toString("base64") }));
    const leads = new CrmLeadService(dataSource, crypto, filters, undefined, workflowEvents);
    const deals = new CrmDealService(dataSource, leads, filters, workflowEvents);
    const tasks = new CrmTaskService(dataSource, leads, workflowEvents);
    const metadata = new CrmMetadataService(dataSource);
    const crm = new CrmService(dataSource, crypto, filters);
    const workflows = new CrmWorkflowService(dataSource, filters, leads);
    const runtime = new CrmWorkflowRuntimeService(dataSource, workflows, workflowEvents, leads, deals, tasks, metadata);

    const marker = `Trial workflow ${randomUUID()}`;
    const organization = await crm.createOrganization({ name: marker }, actorId);
    organizationId = organization.id;
    const tenant = (await dataSource.query<Array<{ id: string }>>(
      "INSERT INTO coffee_shops(name,slug,status) VALUES($1,$2,'PREVIEW') RETURNING id", [`${marker} cafe`, `trial-${randomUUID()}`]))[0]!;
    tenantId = tenant.id;
    const plan = (await dataSource.query<Array<{ id: string }>>("SELECT id FROM subscription_plans WHERE key='silver' LIMIT 1"))[0];
    assert.ok(plan, "Trial Workflow integration test requires a subscription plan");
    const subscription = (await dataSource.query<Array<{ id: string; trial_ends_at: Date }>>(`
      INSERT INTO subscriptions(coffee_shop_id,plan_id,status,trial_started_at,trial_ends_at)
      VALUES($1,$2,'TRIALING',now()-interval '1 day',now()+interval '2 days') RETURNING id,trial_ends_at`, [tenantId, plan.id]))[0]!;
    subscriptionId = subscription.id;
    await crm.linkOrganizationTenant(organizationId, tenantId, actorId);
    const before = (await dataSource.query<Array<{ status: string; trial_ends_at: Date }>>(
      "SELECT status,trial_ends_at FROM subscriptions WHERE id=$1", [subscriptionId]))[0]!;

    const workflow = await workflows.create({
      name: marker, triggerType: "TRIAL_ENDING", triggerConfig: { daysBefore: 3 }, conditionEntityType: "ORGANIZATION",
      conditions: { version: 1, logic: "AND", conditions: [{ field: "name", operator: "equals", value: marker }] }, enabled: true,
      actions: [{ type: "CREATE_TASK", config: { recordType: "ORGANIZATION", title: "Trial follow-up", dueInDays: 1, assigneeStrategy: "UNASSIGNED", userId: null } }],
    }, actorId);
    workflowId = workflow.id;

    await runtime.process();
    await runtime.process();
    const scheduled = await dataSource.query<Array<{ source_key: string; status: string }>>(`
      SELECT source_key,status FROM crm_workflow_events WHERE target_workflow_id=$1 AND event_type='TRIAL_ENDING' AND subject_id=$2`, [workflowId, organizationId]);
    assert.equal(scheduled.length, 1);
    assert.equal(scheduled[0]?.source_key, `trial-ending:${workflowId}:${subscriptionId}:${new Date(subscription.trial_ends_at).getTime()}`);
    assert.equal(scheduled[0]?.status, "PROCESSED");
    const executions = await dataSource.query<Array<{ status: string; total: number }>>(`
      SELECT e.status,count(*)::int AS total FROM crm_workflow_executions e WHERE e.workflow_id=$1 GROUP BY e.status`, [workflowId]);
    assert.deepEqual(executions, [{ status: "SUCCEEDED", total: 1 }]);
    const createdTasks = await dataSource.query<Array<{ total: number }>>(`
      SELECT count(*)::int AS total FROM crm_tasks t JOIN crm_workflow_action_executions a ON a.id=t.automation_action_execution_id
      JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1 AND t.organization_id=$2`, [workflowId, organizationId]);
    assert.equal(createdTasks[0]?.total, 1);
    const after = (await dataSource.query<Array<{ status: string; trial_ends_at: Date }>>(
      "SELECT status,trial_ends_at FROM subscriptions WHERE id=$1", [subscriptionId]))[0]!;
    assert.equal(after.status, before.status);
    assert.equal(after.trial_ends_at.getTime(), before.trial_ends_at.getTime());
  } finally {
    if (dataSource.isInitialized) {
      if (workflowId) {
        await dataSource.query(`DELETE FROM crm_tasks WHERE automation_action_execution_id IN (
          SELECT a.id FROM crm_workflow_action_executions a JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1)`, [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_action_executions WHERE workflow_execution_id IN (SELECT id FROM crm_workflow_executions WHERE workflow_id=$1)", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_executions WHERE workflow_id=$1", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_events WHERE target_workflow_id=$1", [workflowId]);
        await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [[workflowId, organizationId]]);
        await dataSource.query("DELETE FROM crm_workflows WHERE id=$1", [workflowId]);
      }
      if (organizationId) await dataSource.query("DELETE FROM crm_organizations WHERE id=$1", [organizationId]);
      if (subscriptionId) await dataSource.query("DELETE FROM subscriptions WHERE id=$1", [subscriptionId]);
      if (tenantId) await dataSource.query("DELETE FROM coffee_shops WHERE id=$1", [tenantId]);
      await dataSource.destroy();
    }
  }
});

test("overdue-Task scanner uses a stable Task/due-date key and executes once", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const workflowEvents = new CrmWorkflowEventService();
  let actorId = "";
  let workflowId = "";
  let leadId = "";
  let seedTaskId = "";
  let scanStartedAt = new Date();
  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>(`SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND EXISTS (
      SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
      JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE upr.user_id=u.id AND p.key='crm.manage') ORDER BY u.created_at LIMIT 1`);
    assert.ok(actors[0], "Overdue Task Workflow integration test requires a platform CRM manager");
    actorId = actors[0].id;
    const activeOverdueWorkflows = await dataSource.query<Array<{ id: string }>>(
      "SELECT id FROM crm_workflows WHERE trigger_type='TASK_OVERDUE' AND enabled=TRUE AND archived_at IS NULL");
    assert.equal(activeOverdueWorkflows.length, 0, "Run scheduled-trigger integration tests against an isolated CRM database");
    const filters = new CrmFilterService(dataSource);
    const crypto = new AuthCryptoService(new ConfigService({ AUTH_PEPPER: "crm-overdue-workflow-test-pepper-long-enough", PII_ENCRYPTION_KEY: Buffer.alloc(32, 29).toString("base64") }));
    const leads = new CrmLeadService(dataSource, crypto, filters, undefined, workflowEvents);
    const deals = new CrmDealService(dataSource, leads, filters, workflowEvents);
    const tasks = new CrmTaskService(dataSource, leads, workflowEvents);
    const metadata = new CrmMetadataService(dataSource);
    const workflows = new CrmWorkflowService(dataSource, filters, leads);
    const runtime = new CrmWorkflowRuntimeService(dataSource, workflows, workflowEvents, leads, deals, tasks, metadata);
    const marker = `Overdue workflow ${randomUUID()}`;
    const workflow = await workflows.create({
      name: marker, triggerType: "TASK_OVERDUE", triggerConfig: {}, conditionEntityType: "LEAD",
      conditions: { version: 1, logic: "AND", conditions: [{ field: "businessName", operator: "equals", value: marker }] }, enabled: true,
      actions: [{ type: "CREATE_TASK", config: { recordType: "LEAD", title: "Overdue follow-up", dueInDays: 1, assigneeStrategy: "UNASSIGNED", userId: null } }],
    }, actorId);
    workflowId = workflow.id;
    const lead = await leads.create({ businessName: marker, source: CrmLeadSource.Manual }, actorId);
    leadId = lead.id;
    const dueAt = new Date(Date.now() - 60_000);
    const seedTask = await tasks.create({ leadId, title: "Overdue scanner seed", dueAt: dueAt.toISOString() }, actorId);
    seedTaskId = seedTask.id;
    const sourceKey = `task-overdue:${seedTaskId}:${dueAt.getTime()}`;
    scanStartedAt = new Date();

    await runtime.process();
    await runtime.process();
    const scheduled = await dataSource.query<Array<{ source_key: string; status: string }>>(
      "SELECT source_key,status FROM crm_workflow_events WHERE source_key=$1", [sourceKey]);
    assert.deepEqual(scheduled, [{ source_key: sourceKey, status: "PROCESSED" }]);
    const executions = await dataSource.query<Array<{ status: string; total: number }>>(
      "SELECT status,count(*)::int AS total FROM crm_workflow_executions WHERE workflow_id=$1 GROUP BY status", [workflowId]);
    assert.deepEqual(executions, [{ status: "SUCCEEDED", total: 1 }]);
    const createdTasks = await dataSource.query<Array<{ total: number }>>(`
      SELECT count(*)::int AS total FROM crm_tasks t JOIN crm_workflow_action_executions a ON a.id=t.automation_action_execution_id
      JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1 AND t.lead_id=$2`, [workflowId, leadId]);
    assert.equal(createdTasks[0]?.total, 1);
  } finally {
    if (dataSource.isInitialized) {
      if (workflowId) {
        await dataSource.query(`DELETE FROM crm_tasks WHERE automation_action_execution_id IN (
          SELECT a.id FROM crm_workflow_action_executions a JOIN crm_workflow_executions e ON e.id=a.workflow_execution_id WHERE e.workflow_id=$1)`, [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_action_executions WHERE workflow_execution_id IN (SELECT id FROM crm_workflow_executions WHERE workflow_id=$1)", [workflowId]);
        await dataSource.query("DELETE FROM crm_workflow_executions WHERE workflow_id=$1", [workflowId]);
        await dataSource.query(`DELETE FROM crm_workflow_events WHERE target_workflow_id=$1
          OR (event_type='TASK_OVERDUE' AND created_at >= $2)`, [workflowId, scanStartedAt]);
        await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [[workflowId, leadId, seedTaskId]]);
        await dataSource.query("DELETE FROM crm_workflows WHERE id=$1", [workflowId]);
      }
      if (seedTaskId) await dataSource.query("DELETE FROM crm_tasks WHERE id=$1", [seedTaskId]);
      if (leadId) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=$1", [leadId]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=$1", [leadId]);
      }
      await dataSource.destroy();
    }
  }
});
