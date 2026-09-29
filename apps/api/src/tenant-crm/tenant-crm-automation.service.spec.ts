import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { AUTOMATION_MAX_ATTEMPTS, AUTOMATION_MAX_DEPTH, AUTOMATION_STALE_MS, automationError,
  automationRetryDelay } from "./tenant-crm-automation.util";
import { TenantCrmAutomationService } from "./tenant-crm-automation.service";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";
import { TenantCrmService } from "./tenant-crm.service";
import { DomainEventTypes } from "../database/domain-event.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { DataSource } from "typeorm";
import { CreateTenantCrmAutomationDto } from "./dto/tenant-crm-automations.dto";
import { TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantCrmAutomationController } from "./tenant-crm-automation.controller";

test("automation retry policy is bounded and database errors are safe", () => {
  assert.equal(AUTOMATION_MAX_ATTEMPTS, 3);
  assert.equal(AUTOMATION_MAX_DEPTH, 5);
  assert.equal(AUTOMATION_STALE_MS, 300_000);
  assert.equal(automationRetryDelay(1), 2_000);
  assert.equal(automationRetryDelay(2), 10_000);
  assert.equal(automationRetryDelay(20), 10_000);
  assert.deepEqual(automationError({ driverError: { code: "40P01", detail: "customer data" } }, "Failed."), {
    code: "TEMPORARY_DATABASE_ERROR", message: "A temporary database error occurred.", retryable: true,
  });
  assert.deepEqual(automationError(new Error("raw SQL and PII"), "Failed."), {
    code: "AUTOMATION_PROCESSING_FAILED", message: "Failed.", retryable: false,
  });
});

test("automation routes keep read access separate from manage permission", () => {
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantCrmAutomationController), [TenantPermissions.TenantCrmRead]);
  for (const method of ["metadata", "preview", "create", "update", "activate", "pause", "archive"])
    assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, (TenantCrmAutomationController.prototype as any)[method]),
      [TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage]);
});

test("time-trigger conditions reject malformed criteria instead of silently dropping them", async () => {
  const service = new TenantCrmAutomationService({} as never, {} as never, {} as never, {} as never);
  await assert.rejects(() => service.preview("tenant-id", "Asia/Tehran", {
    triggerType: "CLIENT_BIRTHDAY", triggerConfig: {}, conditions: { type: "condition", field: "client.status" },
  } as never), /Time-trigger conditions must be a Phase 4 criteria group/);
});

test("PostgreSQL automation dispatch is tenant-scoped, idempotent, sequential, and time-aware", {
  skip: !process.env.TENANT_CRM_INTEGRATION_DATABASE_URL,
}, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.TENANT_CRM_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const tenantA = randomUUID(), tenantB = randomUUID(), clientA = randomUUID(), clientB = randomUUID();
  const userA = randomUUID(), userB = randomUUID(), tagA = randomUUID(), tagB = randomUUID(), staleTag = randomUUID(), orderA = randomUUID();
  const feature = { enabled: true };
  const subscriptions = { featureState: async (_tenantId: string, key: string) => {
    assert.equal(key, SubscriptionFeatures.TenantCrm);
    return feature;
  } };
  const makeWorker = () => new TenantCrmAutomationService(db, new TenantCrmService(db), new TenantCrmSegmentsService(db), subscriptions as never);
  const first = makeWorker(), second = makeWorker();
  const slugA = `automation-${tenantA.replaceAll("-", "").slice(0, 20)}`;
  const slugB = `automation-${tenantB.replaceAll("-", "").slice(0, 20)}`;
  const newAutomation = (triggerType: string, triggerConfig: Record<string, unknown>, actions: unknown[], conditions?: unknown) =>
    Object.assign(new CreateTenantCrmAutomationDto(), { name: `Test ${randomUUID()}`, triggerType, triggerConfig, actions, conditions });
  const noteAction = { type: "ADD_NOTE" as const, config: { body: "follow up" } };
  const insertEvent = async (tenantId: string, clientId: string, aggregateId = randomUUID(), eventKey = randomUUID()) => db.query(`
    INSERT INTO domain_event_outbox(event_key,event_type,coffee_shop_id,aggregate_type,aggregate_id,payload)
    VALUES($1,$2,$3,'ORDER',$4,jsonb_build_object('orderId',$4::uuid::text,'clientId',$5::uuid::text,'totalAmountToman','250','deliveryMethod','PICKUP'))`,
  [`automation:${eventKey}`, DomainEventTypes.OrderDelivered, tenantId, aggregateId, clientId]);
  const runBoth = async () => Promise.all([(first as any).process(), (second as any).process()]);
  try {
    await db.query(`INSERT INTO coffee_shops(id,name,slug,status,timezone) VALUES($1,'Automation A',$2,'ACTIVE','Asia/Tehran'),($3,'Automation B',$4,'ACTIVE','Asia/Tehran')`,
      [tenantA, slugA, tenantB, slugB]);
    await db.query(`INSERT INTO clients(id,coffee_shop_id,first_name,last_name,phone) VALUES($1,$2,'آوا','رضایی','+989120000091'),($3,$4,'آوا','رضایی','+989120000091')`,
      [clientA, tenantA, clientB, tenantB]);
    await db.query(`INSERT INTO users(id,email) VALUES($1,$2),($3,$4)`, [userA, `${userA}@automation.test`, userB, `${userB}@automation.test`]);
    await db.query(`INSERT INTO coffee_shop_memberships(coffee_shop_id,user_id,status) VALUES($1,$2,'ACTIVE'),($3,$4,'ACTIVE')`, [tenantA, userA, tenantB, userB]);
    await db.query(`INSERT INTO tenant_crm_tags(id,coffee_shop_id,name,created_by_user_id) VALUES($1,$2,'Follow up',$3)`, [tagA, tenantA, userA]);
    await db.query(`INSERT INTO tenant_crm_tags(id,coffee_shop_id,name,created_by_user_id) VALUES($1,$2,'Follow up',$3)`, [tagB, tenantB, userB]);

    const eventAutomation = await first.createDraft(tenantA, userA, newAutomation("ORDER_DELIVERED", {}, [
      { type: "ADD_TAG", config: { tagId: tagA } }, noteAction,
    ]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", eventAutomation.id);
    const tenantBAutomation = await first.createDraft(tenantB, userB, newAutomation("ORDER_DELIVERED", {}, [
      { type: "ADD_TAG", config: { tagId: tagB } }, noteAction,
    ]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantB, "Asia/Tehran", tenantBAutomation.id);
    const staleEventId = randomUUID();
    await insertEvent(tenantA, clientA, orderA, staleEventId);
    await db.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PROCESSING',automation_dispatch_attempts=1,
      automation_dispatch_claimed_at=clock_timestamp()-interval '6 minutes' WHERE event_key=$1`, [`automation:${staleEventId}`]);
    await runBoth();
    const [dispatch] = await db.query<Array<{ status: string; errorCode: string | null }>>(`SELECT automation_dispatch_status AS status,
      automation_dispatch_error_code AS "errorCode" FROM domain_event_outbox WHERE event_key=$1`, [`automation:${staleEventId}`]);
    assert.deepEqual(dispatch, { status: "PROCESSED", errorCode: null });
    let runs = await db.query<Array<{ status: string; count: number }>>(`SELECT status,COUNT(*)::int AS count FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=$2 GROUP BY status`, [tenantA, eventAutomation.id]);
    assert.deepEqual(runs, [{ status: "SUCCEEDED", count: 1 }]);
    const [actionCount] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_automation_actions WHERE coffee_shop_id=$1`, [tenantA]);
    assert.ok(actionCount);
    assert.equal(actionCount.total, 2);
    const [effects] = await db.query<Array<{ notes: number; tags: number }>>(`SELECT
      (SELECT COUNT(*)::int FROM tenant_crm_client_notes WHERE coffee_shop_id=$1 AND client_id=$2) AS notes,
      (SELECT COUNT(*)::int FROM tenant_crm_client_tags WHERE coffee_shop_id=$1 AND client_id=$2) AS tags`, [tenantA, clientA]);
    assert.deepEqual(effects, { notes: 1, tags: 1 });

    await db.query(`UPDATE domain_event_outbox SET automation_dispatch_status='PENDING',automation_dispatch_attempts=0,automation_dispatch_claimed_at=NULL
      WHERE event_key=$1`, [`automation:${staleEventId}`]);
    await runBoth();
    const [replayed] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_client_notes WHERE coffee_shop_id=$1 AND client_id=$2`, [tenantA, clientA]);
    assert.ok(replayed);
    assert.equal(replayed.total, 1);

    const skippedAutomation = await first.createDraft(tenantA, userA, newAutomation("ORDER_DELIVERED", {}, [noteAction], {
      type: "group", version: 1, operator: "AND", conditions: [{ type: "condition", field: "client.status", operator: "equals", value: "BLOCKED" }],
    }) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", skippedAutomation.id);
    await insertEvent(tenantA, clientA);
    await runBoth();
    const [skipped] = await db.query<Array<{ status: string }>>(`SELECT status FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=$2`, [tenantA, skippedAutomation.id]);
    assert.ok(skipped);
    assert.equal(skipped.status, "SKIPPED");

    feature.enabled = false;
    await insertEvent(tenantB, clientB);
    await runBoth();
    const [tenantBCount] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1`, [tenantB]);
    assert.ok(tenantBCount);
    assert.equal(tenantBCount.total, 0);
    feature.enabled = true;
    await insertEvent(tenantB, clientB);
    await runBoth();
    const [tenantBEffects] = await db.query<Array<{ total: number; tags: number; notes: number }>>(`SELECT
      (SELECT COUNT(*)::int FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND automation_id=$2 AND status='SUCCEEDED') AS total,
      (SELECT COUNT(*)::int FROM tenant_crm_client_tags WHERE coffee_shop_id=$1 AND client_id=$3 AND tag_id=$4) AS tags,
      (SELECT COUNT(*)::int FROM tenant_crm_client_notes WHERE coffee_shop_id=$1 AND client_id=$3) AS notes`,
    [tenantB, tenantBAutomation.id, clientB, tagB]);
    assert.deepEqual(tenantBEffects, { total: 1, tags: 1, notes: 1 });

    const lowRating = await first.createDraft(tenantA, userA, newAutomation("FEEDBACK_CREATED", {}, [noteAction], {
      type: "group", version: 1, operator: "AND", conditions: [
        { type: "condition", field: "event.feedback.rating", operator: "less_or_equal", value: 2 },
      ],
    }) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", lowRating.id);
    const recoveryTag = await db.query<Array<{ id: string }>>(`INSERT INTO tenant_crm_tags(id,coffee_shop_id,name,created_by_user_id)
      VALUES($1,$2,'Needs recovery',$3) RETURNING id`, [randomUUID(), tenantA, userA]);
    const resolveFeedback = await first.createDraft(tenantA, userA, newAutomation("FEEDBACK_RESOLVED", {}, [
      { type: "REMOVE_TAG", config: { tagId: recoveryTag[0]!.id } },
    ]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", resolveFeedback.id);
    const feedbackService = new TenantCrmService(db);
    await feedbackService.createFeedback(tenantA, userA, { clientId: clientA, rating: 2 } as any);
    const [feedbackEvent] = await db.query<Array<{ aggregateId: string }>>(`SELECT aggregate_id AS "aggregateId" FROM domain_event_outbox
      WHERE coffee_shop_id=$1 AND event_type=$2 ORDER BY created_at,id LIMIT 1`, [tenantA, DomainEventTypes.TenantCrmFeedbackCreated]);
    assert.ok(feedbackEvent);
    await feedbackService.createFeedback(tenantA, userA, { clientId: clientA, rating: 5 } as any);
    await runBoth();
    await db.query(`INSERT INTO tenant_crm_client_tags(coffee_shop_id,client_id,tag_id,created_by_user_id) VALUES($1,$2,$3,$4)`,
      [tenantA, clientA, recoveryTag[0]!.id, userA]);
    await feedbackService.resolveFeedback(tenantA, userA, feedbackEvent.aggregateId, {} as any);
    await runBoth();
    const [feedbackRuns] = await db.query<Array<{ created: number; skipped: number; resolved: number; removed: number }>>(`SELECT
      (SELECT COUNT(*)::int FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND automation_id=$2 AND status='SUCCEEDED') AS created,
      (SELECT COUNT(*)::int FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND automation_id=$2 AND status='SKIPPED') AS skipped,
      (SELECT COUNT(*)::int FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND automation_id=$3 AND status='SUCCEEDED') AS resolved,
      (SELECT COUNT(*)::int FROM tenant_crm_client_tags WHERE coffee_shop_id=$1 AND client_id=$4 AND tag_id=$5) AS removed`,
    [tenantA, lowRating.id, resolveFeedback.id, clientA, recoveryTag[0]!.id]);
    assert.deepEqual(feedbackRuns, { created: 1, skipped: 1, resolved: 1, removed: 0 });

    await first.pause(tenantA, eventAutomation.id);
    await first.pause(tenantA, skippedAutomation.id);
    await first.pause(tenantB, tenantBAutomation.id);
    await db.query(`INSERT INTO tenant_crm_tags(id,coffee_shop_id,name,created_by_user_id) VALUES($1,$2,'Recovery replay',$3)`,
      [staleTag, tenantA, userA]);
    const staleAutomation = await first.createDraft(tenantA, userA, newAutomation("ORDER_DELIVERED", {}, [
      { type: "ADD_TAG", config: { tagId: staleTag } }, noteAction,
    ]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", staleAutomation.id);
    const staleEvent = randomUUID();
    await insertEvent(tenantA, clientA, randomUUID(), staleEvent);
    await (first as any).dispatchEvents(20);
    const [staleExecution] = await db.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=$2`, [tenantA, staleAutomation.id]);
    assert.ok(staleExecution);
    await db.query(`UPDATE tenant_crm_automation_executions SET status='PROCESSING',attempts=1,
      claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=$1`, [staleExecution.id]);
    await (first as any).recoverStale();
    await (first as any).processExecutions(20);
    await (first as any).processActions(1);
    const [secondAction] = await db.query<Array<{ id: string }>>(`SELECT id FROM tenant_crm_automation_actions
      WHERE coffee_shop_id=$1 AND automation_execution_id=$2 AND action_index=1`, [tenantA, staleExecution.id]);
    assert.ok(secondAction);
    await db.query(`UPDATE tenant_crm_automation_actions SET status='PROCESSING',attempts=1,
      claimed_at=clock_timestamp()-interval '6 minutes' WHERE id=$1`, [secondAction.id]);
    await (first as any).recoverStale();
    await Promise.all([(first as any).processActions(20), (second as any).processActions(20)]);
    await (first as any).finishExecutions();
    const [recovered] = await db.query<Array<{ status: string; attempts: number; actions: number; retriedActions: number }>>(`SELECT e.status,e.attempts,
      (SELECT COUNT(*)::int FROM tenant_crm_automation_actions a WHERE a.coffee_shop_id=e.coffee_shop_id AND a.automation_execution_id=e.id AND a.status='SUCCEEDED') AS actions,
      (SELECT COUNT(*)::int FROM tenant_crm_automation_actions a WHERE a.coffee_shop_id=e.coffee_shop_id AND a.automation_execution_id=e.id AND a.status='SUCCEEDED' AND a.attempts=2) AS "retriedActions"
      FROM tenant_crm_automation_executions e WHERE e.coffee_shop_id=$1 AND e.id=$2`, [tenantA, staleExecution.id]);
    assert.deepEqual(recovered, { status: "SUCCEEDED", attempts: 2, actions: 2, retriedActions: 1 });
    await (first as any).processActions(20);
    const [replayedEffects] = await db.query<Array<{ tags: number; notes: number }>>(`SELECT
      (SELECT COUNT(*)::int FROM tenant_crm_client_tags WHERE coffee_shop_id=$1 AND client_id=$2 AND tag_id=$3) AS tags,
      (SELECT COUNT(*)::int FROM tenant_crm_client_notes WHERE coffee_shop_id=$1 AND client_id=$2 AND automation_action_execution_id IN
        (SELECT id FROM tenant_crm_automation_actions WHERE coffee_shop_id=$1 AND automation_execution_id=$4)) AS notes`,
    [tenantA, clientA, staleTag, staleExecution.id]);
    assert.deepEqual(replayedEffects, { tags: 1, notes: 1 });

    const causalEvent = randomUUID();
    await insertEvent(tenantA, clientA, randomUUID(), causalEvent);
    await db.query(`UPDATE domain_event_outbox SET causation_execution_id=$2,automation_depth=1 WHERE event_key=$1`,
      [`automation:${causalEvent}`, staleExecution.id]);
    await (first as any).dispatchEvents(20);
    const [loopRun] = await db.query<Array<{ status: string }>>(`SELECT status FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=$2 AND source_event_id=(SELECT id FROM domain_event_outbox WHERE event_key=$3)`,
    [tenantA, staleAutomation.id, `automation:${causalEvent}`]);
    assert.equal(loopRun?.status, "LOOP_BLOCKED");
    const depthEvent = randomUUID();
    await insertEvent(tenantA, clientA, randomUUID(), depthEvent);
    await db.query(`UPDATE domain_event_outbox SET automation_depth=$2 WHERE event_key=$1`, [`automation:${depthEvent}`, AUTOMATION_MAX_DEPTH]);
    await (first as any).dispatchEvents(20);
    const [depthState] = await db.query<Array<{ status: string; errorCode: string | null }>>(`SELECT automation_dispatch_status AS status,
      automation_dispatch_error_code AS "errorCode" FROM domain_event_outbox WHERE event_key=$1`, [`automation:${depthEvent}`]);
    assert.deepEqual(depthState, { status: "LOOP_BLOCKED", errorCode: "AUTOMATION_DEPTH_LIMIT" });
    await first.pause(tenantA, staleAutomation.id);
    const pausedEvent = randomUUID();
    await insertEvent(tenantA, clientA, randomUUID(), pausedEvent);
    await (first as any).dispatchEvents(20);
    const [pausedRun] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=$2 AND source_event_id=(SELECT id FROM domain_event_outbox WHERE event_key=$3)`,
    [tenantA, staleAutomation.id, `automation:${pausedEvent}`]);
    assert.equal(pausedRun?.total, 0);

    const [monthDay] = await db.query<Array<{ value: string }>>(`SELECT to_char(clock_timestamp() AT TIME ZONE timezone,'MM-DD') AS value FROM coffee_shops WHERE id=$1`, [tenantA]);
    assert.ok(monthDay);
    await db.query(`INSERT INTO tenant_crm_client_profiles(coffee_shop_id,client_id,birthday_month_day,updated_by_user_id) VALUES($1,$2,$3,$4)`,
      [tenantA, clientA, monthDay.value, userA]);
    const birthday = await first.createDraft(tenantA, userA, newAutomation("CLIENT_BIRTHDAY", {}, [noteAction]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", birthday.id);
    assert.equal((await first.preview(tenantA, "Asia/Tehran", { triggerType: "CLIENT_BIRTHDAY", triggerConfig: {} } as any)).matchingClients, 1);
    const oldOrderId = randomUUID();
    await db.query(`INSERT INTO orders(id,coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,
      discount_total_toman,order_discount_toman,idempotency_key,status_changed_at,created_at)
      VALUES($1,$2,$3,'DELIVERED','OFFLINE','PICKUP',250,250,0,0,$4,clock_timestamp()-interval '60 days',clock_timestamp()-interval '60 days')`,
    [oldOrderId, tenantA, clientA, `automation-${randomUUID()}`]);
    const lapsed = await first.createDraft(tenantA, userA, newAutomation("CLIENT_LAPSED", { days: 45 }, [
      { type: "CREATE_REMINDER", config: { title: "Follow up lapsed customer", dueInDays: 1 } },
    ]) as CreateTenantCrmAutomationDto, "Asia/Tehran");
    await first.activate(tenantA, "Asia/Tehran", lapsed.id);
    const birthdayCandidates = await new TenantCrmSegmentsService(db).timeAutomationCandidates(db.manager, tenantA, "Asia/Tehran", birthday.id,
      "CLIENT_BIRTHDAY", (first as any).timeCriteria("CLIENT_BIRTHDAY", {}, null), 100);
    assert.equal(birthdayCandidates.length, 1);
    await (first as any).scanTimeTriggers();
    await runBoth();
    await (first as any).scanTimeTriggers();
    await (first as any).process();
    const [timeRuns] = await db.query<Array<{ birthday: number; lapsed: number; succeeded: number }>>(`SELECT
      COUNT(*) FILTER (WHERE trigger_type='CLIENT_BIRTHDAY' AND status='SUCCEEDED')::int AS birthday,
      COUNT(*) FILTER (WHERE trigger_type='CLIENT_LAPSED' AND status='SUCCEEDED')::int AS lapsed,
      COUNT(*) FILTER (WHERE status='SUCCEEDED')::int AS succeeded FROM tenant_crm_automation_executions
      WHERE coffee_shop_id=$1 AND automation_id=ANY($2::uuid[])`, [tenantA, [birthday.id, lapsed.id]]);
    assert.ok(timeRuns);
    assert.equal(timeRuns.birthday, 1);
    assert.equal(timeRuns.lapsed, 1);
    assert.equal(timeRuns.succeeded, 2);
    const [reminderCount] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_reminders r
      JOIN tenant_crm_automation_actions a ON a.coffee_shop_id=r.coffee_shop_id AND a.id=r.automation_action_execution_id
      JOIN tenant_crm_automation_executions e ON e.coffee_shop_id=a.coffee_shop_id AND e.id=a.automation_execution_id
      WHERE r.coffee_shop_id=$1 AND r.client_id=$2 AND e.automation_id=$3 AND a.status='SUCCEEDED'`, [tenantA, clientA, lapsed.id]);
    assert.equal(reminderCount?.total, 1);
    const reentryOrder = randomUUID();
    await db.query(`INSERT INTO orders(id,coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,subtotal_before_discount_toman,
      discount_total_toman,order_discount_toman,idempotency_key,status_changed_at,created_at)
      VALUES($1,$2,$3,'DELIVERED','OFFLINE','PICKUP',250,250,0,0,$4,clock_timestamp()-interval '59 days',clock_timestamp()-interval '59 days')`,
    [reentryOrder, tenantA, clientA, `automation-${randomUUID()}`]);
    await (first as any).scanTimeTriggers();
    await runBoth();
    await (first as any).scanTimeTriggers();
    await (first as any).process();
    const [reentryCount] = await db.query<Array<{ total: number; birthdays: number }>>(`SELECT
      COUNT(*) FILTER (WHERE trigger_type='CLIENT_LAPSED' AND status='SUCCEEDED')::int AS total,
      COUNT(*) FILTER (WHERE trigger_type='CLIENT_BIRTHDAY' AND status='SUCCEEDED')::int AS birthdays
      FROM tenant_crm_automation_executions WHERE coffee_shop_id=$1 AND automation_id=ANY($2::uuid[])`, [tenantA, [birthday.id, lapsed.id]]);
    assert.deepEqual(reentryCount, { total: 2, birthdays: 1 });
    const [reentryReminders] = await db.query<Array<{ total: number }>>(`SELECT COUNT(*)::int AS total FROM tenant_crm_reminders r
      JOIN tenant_crm_automation_actions a ON a.coffee_shop_id=r.coffee_shop_id AND a.id=r.automation_action_execution_id
      JOIN tenant_crm_automation_executions e ON e.coffee_shop_id=a.coffee_shop_id AND e.id=a.automation_execution_id
      WHERE r.coffee_shop_id=$1 AND r.client_id=$2 AND e.automation_id=$3 AND a.status='SUCCEEDED'`, [tenantA, clientA, lapsed.id]);
    assert.equal(reentryReminders?.total, 2);
  } finally {
    await db.query(`DELETE FROM tenant_crm_client_tags WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_client_notes WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_reminders WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_automation_actions WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_automation_executions WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_automations WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM domain_event_outbox WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM orders WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_client_profiles WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM tenant_crm_tags WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM clients WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM coffee_shop_memberships WHERE coffee_shop_id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.query(`DELETE FROM users WHERE id=ANY($1::uuid[])`, [[userA, userB]]);
    await db.query(`DELETE FROM coffee_shops WHERE id=ANY($1::uuid[])`, [[tenantA, tenantB]]);
    await db.destroy();
  }
});
