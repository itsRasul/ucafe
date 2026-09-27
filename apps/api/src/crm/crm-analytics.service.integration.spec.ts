import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmAnalyticsService } from "./crm-analytics.service";
import { CrmDealService } from "./crm-deal.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmTaskService } from "./crm-task.service";
import { CrmService } from "./crm.service";
import { CrmLeadSource, CrmLeadStatus } from "./entities/crm-lead.entity";
import { CrmTaskKind } from "./entities/crm-task.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;
const cryptoConfig = {
  AUTH_PEPPER: "crm-analytics-integration-test-pepper-value-long-enough",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 21).toString("base64"),
};

test("CRM analytics derive event, cohort, pipeline, task, and customer metrics from Phase 0–9 records", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const leadIds: string[] = [];
  const dealIds: string[] = [];
  const activityIds: string[] = [];
  const taskIds: string[] = [];
  const contactIds: string[] = [];
  const organizationIds: string[] = [];
  const tenantIds: string[] = [];
  const subscriptionIds: string[] = [];
  const workflowIds: string[] = [];
  let actorId = "";

  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>(`
      SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
        JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
        WHERE upr.user_id=u.id AND p.key='crm.manage'
      ) ORDER BY u.created_at LIMIT 1
    `);
    assert.ok(actors[0], "CRM analytics integration test requires an active CRM manager");
    actorId = actors[0].id;

    const analytics = new CrmAnalyticsService(dataSource, new SubscriptionsService(dataSource, null as never));
    const crm = new CrmService(dataSource, new AuthCryptoService(new ConfigService(cryptoConfig)));
    const leads = new CrmLeadService(dataSource, new AuthCryptoService(new ConfigService(cryptoConfig)));
    const deals = new CrmDealService(dataSource, leads);
    const activities = new CrmActivityService(dataSource);
    const tasks = new CrmTaskService(dataSource, leads);
    const marker = `crm-analytics-${randomUUID()}`;
    const period = { period: "custom" as const, start: "2099-05-15", end: "2099-05-15" };
    const eventAt = "2099-05-15T12:00:00.000Z";
    const range = period;
    const baselineOverdueTasks = (await analytics.work(period)).metrics.overdueTasks;

    const convertedLead = await leads.create({ businessName: `${marker}-converted`, contactName: `${marker} contact`, source: CrmLeadSource.Manual }, actorId);
    leadIds.push(convertedLead.id);
    await leads.changeStatus(convertedLead.id, { status: CrmLeadStatus.Contacted }, actorId);
    await leads.qualify(convertedLead.id, {}, actorId);
    const converted = await leads.convert(convertedLead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId);
    organizationIds.push(converted.organizationId!);
    contactIds.push(converted.primaryContactId!);

    const openLead = await leads.create({ businessName: `${marker}-open`, contactName: `${marker} contact`, source: CrmLeadSource.Referral, organizationId: converted.organizationId, primaryContactId: converted.primaryContactId }, actorId);
    leadIds.push(openLead.id);
    await leads.changeStatus(openLead.id, { status: CrmLeadStatus.Contacted }, actorId);
    await leads.qualify(openLead.id, {}, actorId);

    const wonDeal = await deals.create({ title: `${marker}-won`, organizationId: converted.organizationId!, primaryContactId: converted.primaryContactId!, originatingLeadId: convertedLead.id, estimatedAmountToman: "900000" }, actorId);
    dealIds.push(wonDeal.id);
    await deals.changeStage(wonDeal.id, { expectedStage: "DISCOVERY" as never, stage: "DEMO_SCHEDULED" as never }, actorId);
    await deals.win(wonDeal.id, actorId);
    const openDeal = await deals.create({ title: `${marker}-open-deal`, organizationId: converted.organizationId!, primaryContactId: converted.primaryContactId!, originatingLeadId: openLead.id, estimatedAmountToman: "1234567" }, actorId);
    dealIds.push(openDeal.id);
    const directDeal = await deals.create({ title: `${marker}-direct-deal`, organizationId: converted.organizationId! }, actorId);
    dealIds.push(directDeal.id);

    const activity = await activities.create({ activityType: "DEMO" as never, subject: `${marker}-demo`, occurredAt: new Date().toISOString(), outcome: "COMPLETED", dealId: openDeal.id }, actorId);
    activityIds.push(activity.id);
    const task = await tasks.create({ title: `${marker}-follow-up`, kind: CrmTaskKind.FollowUp, dueAt: eventAt, assignedToUserId: actorId, dealId: openDeal.id }, actorId);
    taskIds.push(task.id);
    await tasks.complete(task.id, actorId);
    const overdueTask = await tasks.create({ title: `${marker}-overdue`, kind: CrmTaskKind.FollowUp, dueAt: new Date(Date.now() - 86_400_000).toISOString(), assignedToUserId: actorId, dealId: openDeal.id }, actorId);
    taskIds.push(overdueTask.id);

    const leadsForPeriod = [convertedLead.id, openLead.id];
    await dataSource.query(`UPDATE crm_leads SET created_at=$2::timestamptz,qualified_at=$2::timestamptz,converted_at=CASE WHEN id=$3 THEN $2::timestamptz ELSE NULL END WHERE id=ANY($1::uuid[])`, [leadsForPeriod, eventAt, convertedLead.id]);
    await dataSource.query(`WITH ordered AS (SELECT id,row_number() OVER (PARTITION BY lead_id ORDER BY created_at,id)-1 AS n FROM crm_lead_status_history WHERE lead_id=ANY($1::uuid[]))
      UPDATE crm_lead_status_history h SET created_at=$2::timestamptz + ordered.n * interval '1 minute' FROM ordered WHERE h.id=ordered.id`, [leadsForPeriod, eventAt]);
    await dataSource.query(`UPDATE crm_deals SET created_at=$2,won_at=CASE WHEN id=$3 THEN $2::timestamptz+interval '2 minutes' ELSE NULL END,
      closed_at=CASE WHEN id=$3 THEN $2::timestamptz+interval '2 minutes' ELSE NULL END WHERE id=ANY($1::uuid[])`, [[wonDeal.id, openDeal.id, directDeal.id], eventAt, wonDeal.id]);
    await dataSource.query(`WITH ordered AS (SELECT id,row_number() OVER (PARTITION BY deal_id ORDER BY created_at,id)-1 AS n FROM crm_deal_stage_history WHERE deal_id=ANY($1::uuid[]))
      UPDATE crm_deal_stage_history h SET created_at=$2::timestamptz + ordered.n * interval '1 minute' FROM ordered WHERE h.id=ordered.id`, [[wonDeal.id, openDeal.id, directDeal.id], eventAt]);
    await dataSource.query("UPDATE crm_activities SET occurred_at=$2 WHERE id=$1", [activity.id, eventAt]);
    await dataSource.query("UPDATE crm_tasks SET due_at=$2,created_at=$2 WHERE id=$1", [task.id, eventAt]);
    await dataSource.query("UPDATE platform_audit_events SET created_at=$2 WHERE target_type='crm_task' AND target_id=$1 AND action='crm.task.completed'", [task.id, eventAt]);
    await dataSource.query("UPDATE crm_tasks SET due_at=now()-interval '1 day',created_at=$2 WHERE id=$1", [overdueTask.id, eventAt]);
    await dataSource.query(`INSERT INTO crm_lead_scores(lead_id,configured,fit_score,engagement_score,overall_score) VALUES($1,true,80,70,75),($2,true,20,20,20)`, [convertedLead.id, openLead.id]);

    const workflow = (await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_workflows(name,trigger_type,condition_entity_type,conditions,actions,created_by_user_id)
      VALUES($1,'LEAD_CREATED','LEAD','{}'::jsonb,'[{"type":"CREATE_TASK"}]'::jsonb,$2) RETURNING id
    `, [`${marker}-workflow`, actorId]))[0]!;
    workflowIds.push(workflow.id);
    for (const [status, attempt, manualRetryCount] of [["SUCCEEDED", 1, 0], ["FAILED", 1, 1], ["RETRYING", 2, 0]] as const) {
      const correlationId = randomUUID();
      const event = (await dataSource.query<Array<{ id: string }>>(`
        INSERT INTO crm_workflow_events(source_key,event_type,subject_type,subject_id,target_workflow_id,correlation_id,status,created_at)
        VALUES($1,'LEAD_CREATED','LEAD',$2,$3,$4,'PROCESSED',$5) RETURNING id
      `, [`${marker}-${status}`, convertedLead.id, workflow.id, correlationId, eventAt]))[0]!;
      const execution = (await dataSource.query<Array<{ id: string }>>(`
        INSERT INTO crm_workflow_executions(workflow_id,event_id,workflow_version,trigger_type,record_type,record_id,status,workflow_snapshot,correlation_id,automation_depth,created_at)
        VALUES($1,$2,1,'LEAD_CREATED','LEAD',$3,$4,'{}'::jsonb,$5,0,$6) RETURNING id
      `, [workflow.id, event.id, convertedLead.id, status, correlationId, eventAt]))[0]!;
      const action = (await dataSource.query<Array<{ id: string }>>(`
        INSERT INTO crm_workflow_action_executions(workflow_execution_id,action_index,action_type,config,status,attempt,manual_retry_count,completed_at)
        VALUES($1,0,'CREATE_TASK','{}'::jsonb,$2::varchar,$3,$4,CASE WHEN $2::varchar IN ('SUCCEEDED','FAILED') THEN $5::timestamptz ELSE NULL END) RETURNING id
      `, [execution.id, status, attempt, manualRetryCount, eventAt]))[0]!;
      if (status === "SUCCEEDED") await dataSource.query("UPDATE crm_tasks SET automation_action_execution_id=$2 WHERE id=$1", [task.id, action.id]);
    }

    const overview = await analytics.overview(period);
    assert.equal(overview.metrics.leadsCreated.value, 2);
    assert.equal(overview.metrics.leadQualifiedRate.value, 100);
    assert.equal(overview.metrics.wonDeals.value, 1);
    assert.equal(overview.metrics.averageWinSalesCycleDays, 0);
    assert.equal(overview.metrics.openDeals, 2);
    assert.equal(overview.metrics.openPipelineValueToman, "1234567");
    assert.equal(overview.metrics.taskCompletionRate.value, 100);

    const funnel = await analytics.funnel(range);
    assert.deepEqual(funnel.stages.map((stage) => stage.value), [2, 2, 2, 2, 1]);
    assert.equal(funnel.leadsConvertedToOrganization.value, 1);
    const pipeline = await analytics.pipeline(range);
    assert.equal(pipeline.stages.reduce((sum, stage) => sum + stage.visits, 0), 4);
    assert.equal(pipeline.stages.reduce((sum, stage) => sum + stage.openDeals, 0), 2);
    assert.equal(pipeline.stages.reduce((sum, stage) => sum + stage.dealsProgressed, 0), 2);
    const sources = await analytics.sources(range);
    const manual = sources.items.find((item) => item.source === CrmLeadSource.Manual)!;
    assert.equal(manual.leadsCreated, 1);
    assert.equal(manual.qualified, 1);
    assert.equal(manual.dealsCreated, 1);
    assert.equal(manual.dealsWon, 1);
    const referral = sources.items.find((item) => item.source === CrmLeadSource.Referral)!;
    assert.equal(referral.leadsCreated, 1);
    assert.equal(referral.dealsCreated, 1);
    const unknown = sources.items.find((item) => item.source === "UNKNOWN_DIRECT")!;
    assert.equal(unknown.leadsCreated, 0);
    assert.equal(unknown.dealsCreated, 1);
    const work = await analytics.work(period);
    assert.equal(work.metrics.activities, 1);
    assert.equal(work.metrics.completedTasks, 1);
    assert.equal(work.metrics.completedDueFollowUps, 1);
    assert.equal(work.metrics.overdueTasks - baselineOverdueTasks, 1);
    assert.equal(work.metrics.overdueFollowUps, 1);
    assert.equal(work.activitySeries.reduce((sum, bucket) => sum + bucket.value, 0), 1);
    assert.equal((await analytics.owners(period)).items.some((item) => item.activities === 1), true);
    const scoring = await analytics.scoring(range);
    assert.equal(scoring.bands.length, 5);
    assert.equal(scoring.bands.find((band) => band.band === "HIGH")?.converted, 1, JSON.stringify(scoring.bands));
    assert.equal(scoring.bands.find((band) => band.band === "LOW")?.qualified, 1);
    const automation = await analytics.automation(period);
    assert.deepEqual(automation.summary, { executions: 3, succeeded: 1, failed: 1, terminal: 2, retriedExecutions: 2, automationTasksCreated: 1 });
    assert.equal(automation.items[0]?.successRate, 50);

    const plan = (await dataSource.query<Array<{ id: string; key: string; name: string }>>("SELECT id,key,name FROM subscription_plans WHERE status='ACTIVE' ORDER BY sort_order LIMIT 1"))[0];
    assert.ok(plan, "CRM analytics integration test requires an active subscription plan");
    const customers = await Promise.all(["trial", "paid"].map(async (kind) => {
      const organization = kind === "trial" ? null : await crm.createOrganization({ name: `${marker}-${kind}-org` }, actorId);
      const targetOrganizationId = organization?.id ?? converted.organizationId!;
      if (organization) organizationIds.push(organization.id);
      const shop = (await dataSource.query<Array<{ id: string }>>(
        "INSERT INTO coffee_shops(name,slug,status) VALUES($1,$2,'PREVIEW') RETURNING id",
        [`${marker}-${kind}`, `${marker.slice(0, 40).toLowerCase().replaceAll(/[^a-z0-9-]/g, "-")}-${kind}`],
      ))[0]!;
      tenantIds.push(shop.id);
      const isPaid = kind === "paid";
      const subscription = (await dataSource.query<Array<{ id: string }>>(`
        INSERT INTO subscriptions(coffee_shop_id,plan_id,status,trial_started_at,trial_ends_at,current_period_started_at,current_period_ends_at,paid_through_at)
        VALUES($1,$2,$3,$4,$5,CASE WHEN $6 THEN $4::timestamptz ELSE NULL END,CASE WHEN $6 THEN $5::timestamptz ELSE NULL END,CASE WHEN $6 THEN $5::timestamptz ELSE NULL END) RETURNING id
      `, [shop.id, plan.id, isPaid ? "ACTIVE" : "TRIALING", eventAt, "2099-06-15T12:00:00.000Z", isPaid]))[0]!;
      subscriptionIds.push(subscription.id);
      if (isPaid) await dataSource.query(`
        INSERT INTO subscription_payments(subscription_id,status,amount_toman,operation,plan_key_snapshot,plan_name_snapshot,period_started_at,period_ends_at,paid_at)
        VALUES($1,'PAID',1,'TRIAL_TO_PAID',$2,$3,$4,$5,$4)
      `, [subscription.id, plan.key, plan.name, eventAt, "2099-06-15T12:00:00.000Z"]);
      await crm.linkOrganizationTenant(targetOrganizationId, shop.id, actorId);
      return targetOrganizationId;
    }));
    assert.equal(customers.length, 2);
    const customerMetrics = await analytics.customers(period);
    assert.equal(customerMetrics.activeTrials, 1);
    assert.equal(customerMetrics.activePaidCustomers, 1);
    assert.equal(customerMetrics.trialsStarted, 2);
    assert.equal(customerMetrics.completedTrials, 1);
    assert.equal(customerMetrics.trialToPaid, 1);
    assert.equal(customerMetrics.trialToPaidRate, 100);
    assert.equal(customerMetrics.plans.reduce((sum, item) => sum + item.customers, 0), 1);
  } finally {
    if (dataSource.isInitialized) {
      const targetIds = [...activityIds, ...taskIds, ...dealIds, ...leadIds, ...organizationIds, ...contactIds, ...tenantIds];
      if (targetIds.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [targetIds]);
      if (activityIds.length) await dataSource.query("DELETE FROM crm_activities WHERE id=ANY($1::uuid[])", [activityIds]);
      if (taskIds.length) await dataSource.query("DELETE FROM crm_tasks WHERE id=ANY($1::uuid[])", [taskIds]);
      if (workflowIds.length) {
        await dataSource.query("DELETE FROM crm_workflow_action_executions WHERE workflow_execution_id IN (SELECT id FROM crm_workflow_executions WHERE workflow_id=ANY($1::uuid[]))", [workflowIds]);
        await dataSource.query("DELETE FROM crm_workflow_executions WHERE workflow_id=ANY($1::uuid[])", [workflowIds]);
        await dataSource.query("DELETE FROM crm_workflow_events WHERE target_workflow_id=ANY($1::uuid[])", [workflowIds]);
        await dataSource.query("DELETE FROM crm_workflows WHERE id=ANY($1::uuid[])", [workflowIds]);
      }
      if (dealIds.length) {
        await dataSource.query("DELETE FROM crm_deal_stage_history WHERE deal_id=ANY($1::uuid[])", [dealIds]);
        await dataSource.query("DELETE FROM crm_deals WHERE id=ANY($1::uuid[])", [dealIds]);
      }
      if (leadIds.length) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_lead_scores WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_lead_score_history WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=ANY($1::uuid[])", [leadIds]);
      }
      if (contactIds.length) await dataSource.query("DELETE FROM crm_contacts WHERE id=ANY($1::uuid[])", [contactIds]);
      if (organizationIds.length) await dataSource.query("DELETE FROM crm_organizations WHERE id=ANY($1::uuid[])", [organizationIds]);
      if (subscriptionIds.length) await dataSource.query("DELETE FROM subscription_payments WHERE subscription_id=ANY($1::uuid[])", [subscriptionIds]);
      if (subscriptionIds.length) await dataSource.query("DELETE FROM subscriptions WHERE id=ANY($1::uuid[])", [subscriptionIds]);
      if (tenantIds.length) await dataSource.query("DELETE FROM coffee_shops WHERE id=ANY($1::uuid[])", [tenantIds]);
      await dataSource.destroy();
    }
  }
});
