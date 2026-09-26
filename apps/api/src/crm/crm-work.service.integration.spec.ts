import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmActivityService } from "./crm-activity.service";
import { CrmDealService } from "./crm-deal.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmNoteService } from "./crm-note.service";
import { CrmTaskService } from "./crm-task.service";
import { CrmService } from "./crm.service";
import { CrmOrganization360Service } from "./crm-organization-360.service";
import { CrmTimelineService } from "./crm-timeline.service";
import { CrmActivity, CrmContact, CrmDeal, CrmDealStageHistory, CrmLead, CrmLeadStatusHistory, CrmNote, CrmOrganization, CrmTask } from "./entities";
import { CrmLeadSource } from "./entities/crm-lead.entity";
import { CrmTaskKind, CrmTaskPriority, CrmTaskStatus } from "./entities/crm-task.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;
const entities = [CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory, CrmDeal, CrmDealStageHistory, CrmActivity, CrmTask, CrmNote];
const cryptoConfig = {
  AUTH_PEPPER: "crm-work-integration-test-pepper-value-long-enough",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 31).toString("base64"),
};

test("CRM work persists relations, lifecycle, filters, Lead conversion, and privacy-safe audit rows", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, entities, synchronize: false, migrationsRun: false });
  const organizationIds: string[] = [];
  const contactIds: string[] = [];
  const leadIds: string[] = [];
    const dealIds: string[] = [];
    const activityIds: string[] = [];
  const taskIds: string[] = [];
  const noteIds: string[] = [];
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
    assert.ok(actors[0], "CRM work integration test requires an active CRM manager");
    actorId = actors[0].id;
    const crypto = new AuthCryptoService(new ConfigService(cryptoConfig));
    const crm = new CrmService(dataSource, crypto);
    const leads = new CrmLeadService(dataSource, crypto);
    const activities = new CrmActivityService(dataSource);
    const tasks = new CrmTaskService(dataSource, leads);
    const notes = new CrmNoteService(dataSource);
    const deals = new CrmDealService(dataSource, leads);
    const organization360 = new CrmOrganization360Service(dataSource);
    const timeline = new CrmTimelineService(dataSource);
    const marker = `crm-work-${randomUUID()}`;

    const organization = await crm.createOrganization({ name: `${marker}-one` }, actorId);
    organizationIds.push(organization.id);
    const contact = await crm.createContact(organization.id, { name: "Work Test Contact" }, actorId);
    contactIds.push(contact.id);
    const otherOrganization = await crm.createOrganization({ name: `${marker}-two` }, actorId);
    organizationIds.push(otherOrganization.id);
    const otherContact = await crm.createContact(otherOrganization.id, { name: "Other Work Contact" }, actorId);
    contactIds.push(otherContact.id);
    const deal = await deals.create({ title: `${marker}-deal`, organizationId: organization.id, primaryContactId: contact.id }, actorId);
    dealIds.push(deal.id);

    const occurredAt = new Date(Date.now() - 60_000).toISOString();
    const activity = await activities.create({ activityType: "CALL" as never, subject: `${marker}-call`, occurredAt, outcome: "CONNECTED", organizationId: organization.id, contactId: contact.id, dealId: deal.id }, actorId);
    activityIds.push(activity.id);
    assert.equal(new Date(activity.occurredAt).getTime(), new Date(occurredAt).getTime());
    assert.equal(activity.actorLabel?.startsWith("اپراتور"), true);
    const otherActivity = await activities.create({ activityType: "CALL" as never, subject: `${marker}-other-call`, occurredAt, organizationId: otherOrganization.id, contactId: otherContact.id }, actorId);
    activityIds.push(otherActivity.id);
    await assert.rejects(activities.create({ activityType: "CALL" as never, subject: "wrong organization", occurredAt, organizationId: organization.id, contactId: otherContact.id }, actorId), { status: 400 });

    const lead = await leads.create({ businessName: `${marker}-lead`, contactName: "Prospect", source: CrmLeadSource.Manual }, actorId);
    leadIds.push(lead.id);
    const leadActivity = await activities.create({ activityType: "CALL" as never, subject: `${marker}-lead-call`, occurredAt, leadId: lead.id, outcome: "NO_ANSWER" }, actorId);
    activityIds.push(leadActivity.id);
    const leadTask = await tasks.create({ title: `${marker}-follow-up`, kind: CrmTaskKind.FollowUp, priority: CrmTaskPriority.High, dueAt: new Date(Date.now() - 3_600_000).toISOString(), assignedToUserId: actorId, leadId: lead.id }, actorId);
    taskIds.push(leadTask.id);
    assert.equal(leadTask.status, CrmTaskStatus.Open);
    assert.equal(leadTask.overdue, true);
    assert.equal(leadTask.assignedToUserId, actorId);
    const leadNote = await notes.create({ body: `${marker}-context`, leadId: lead.id }, actorId);
    noteIds.push(leadNote.id);
    assert.equal(leadNote.authorUserId, actorId);

    await leads.changeStatus(lead.id, { status: "CONTACTED" as never }, actorId);
    await leads.qualify(lead.id, {}, actorId);
    const converted = await leads.convert(lead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId);
    organizationIds.push(converted.organizationId!);
    contactIds.push(converted.primaryContactId!);
    const convertedOrganization = await crm.getOrganization(converted.organizationId!);
    assert.equal((await activities.get(leadActivity.id)).organizationId, converted.organizationId, "Lead-only Activity detail resolves its Organization after conversion");
    assert.equal((await activities.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", organizationId: converted.organizationId, sort: "occurredAt", direction: "DESC" })).items.some((item) => item.id === leadActivity.id), true);
    assert.equal((await tasks.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", organizationId: converted.organizationId, assigneeId: "ME", sort: "dueAt", direction: "ASC" }, actorId)).items.some((item) => item.id === leadTask.id), true);
    assert.equal((await notes.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", organizationId: converted.organizationId, sort: "createdAt", direction: "DESC" })).items.some((item) => item.id === leadNote.id), true);

    const convertedDeal = await deals.create({ title: `${marker}-converted-deal`, organizationId: converted.organizationId!, primaryContactId: converted.primaryContactId!, originatingLeadId: lead.id }, actorId);
    dealIds.push(convertedDeal.id);
    await deals.changeStage(convertedDeal.id, { expectedStage: "DISCOVERY" as never, stage: "DEMO_SCHEDULED" as never }, actorId);
    await deals.win(convertedDeal.id, actorId);
    const beforeCompletion = await organization360.overview(converted.organizationId!);
    assert.equal(beforeCompletion.summary.contactCount, 1);
    assert.equal(beforeCompletion.summary.leadCount, 1);
    assert.equal(beforeCompletion.summary.openDealCount, 0);
    assert.equal(beforeCompletion.summary.openTaskCount, 1);
    assert.ok(beforeCompletion.summary.nextTask);
    assert.equal(beforeCompletion.summary.nextTask.id, leadTask.id);
    assert.equal(beforeCompletion.leads.some((item) => item.id === lead.id), true);
    assert.equal(beforeCompletion.deals.some((item) => item.id === convertedDeal.id), true);
    assert.equal(beforeCompletion.openTasks.some((item) => item.id === leadTask.id), true);
    assert.equal(beforeCompletion.recentActivities.some((item) => item.id === leadActivity.id), true);
    assert.equal(beforeCompletion.recentNotes.some((item) => item.id === leadNote.id), true);

    await assert.rejects(tasks.create({ title: "wrong organization", organizationId: organization.id, contactId: otherContact.id }, actorId), { status: 400 });
    await assert.rejects(notes.create({ body: "wrong organization", organizationId: organization.id, dealId: deal.id, contactId: otherContact.id }, actorId), { status: 400 });
    const overdue = await tasks.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", view: "OVERDUE", organizationId: converted.organizationId, assigneeId: "ME", sort: "dueAt", direction: "ASC" }, actorId);
    assert.equal(overdue.items.some((item) => item.id === leadTask.id), true);
    assert.equal((await tasks.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", view: "NO_DUE_DATE", organizationId: converted.organizationId, sort: "dueAt", direction: "ASC" }, actorId)).items.every((item) => item.dueAt === null), true);

    const completed = await tasks.complete(leadTask.id, actorId);
    assert.equal(completed.status, CrmTaskStatus.Completed);
    assert.equal(completed.completedByUserId, actorId);
    assert.ok(completed.completedAt);
    assert.equal(completed.overdue, false);
    const reopened = await tasks.reopen(leadTask.id, actorId);
    assert.equal(reopened.status, CrmTaskStatus.Open);
    assert.equal(reopened.completedAt, null);
    const canceled = await tasks.cancel(leadTask.id, actorId);
    assert.equal(canceled.status, CrmTaskStatus.Canceled);
    assert.equal(canceled.canceledByUserId, actorId);

    const convertedTimeline = await timeline.list(converted.organizationId!, { page: 1, pageSize: 100 });
    const eventTypes = convertedTimeline.items.map((item) => item.type);
    for (const type of ["LEAD_CREATED", "LEAD_STATUS_CHANGED", "LEAD_QUALIFIED", "LEAD_CONVERTED", "DEAL_CREATED", "DEAL_STAGE_CHANGED", "DEAL_WON", "ACTIVITY_LOGGED", "TASK_CREATED", "TASK_COMPLETED", "TASK_REOPENED", "TASK_CANCELED", "NOTE_ADDED"]) {
      assert.ok(eventTypes.includes(type as never), `timeline should include ${type}`);
    }
    const leadCreated = convertedTimeline.items.find((item) => item.type === "LEAD_CREATED")!;
    assert.ok(new Date(leadCreated.occurredAt).getTime() < new Date(convertedOrganization.createdAt).getTime(), "pre-conversion Lead history must remain in Organization context");
    assert.equal(convertedTimeline.items.filter((item) => item.id === `activity:${leadActivity.id}`).length, 1, "an Activity linked to both an Organization and Lead is included once");
    assert.equal(convertedTimeline.items.filter((item) => item.sourceType === "NOTE" && item.sourceId === leadNote.id).length, 1, "a Note produces one timeline item");
    assert.equal((await timeline.list(converted.organizationId!, { category: "LEAD", page: 1, pageSize: 100 })).items.every((item) => item.category === "LEAD"), true);
    const pagedTimeline = await Promise.all(Array.from({ length: Math.ceil(convertedTimeline.total / 3) }, (_, index) => timeline.list(converted.organizationId!, { page: index + 1, pageSize: 3 })));
    const pagedIds = pagedTimeline.flatMap((page) => page.items.map((item) => item.id));
    assert.equal(new Set(pagedIds).size, convertedTimeline.total, "offset pages must neither duplicate nor skip timeline events");
    assert.equal((await timeline.list(organization.id, { page: 1, pageSize: 100 })).items.some((item) => item.organizationId === converted.organizationId), false, "an Organization Timeline cannot include another Organization's records");
    const originalTimeline = await timeline.list(organization.id, { page: 1, pageSize: 100 });
    assert.equal(originalTimeline.items.filter((item) => item.id === `activity:${activity.id}`).length, 1, "Organization + Contact + Deal links do not duplicate one Activity");
    assert.equal(originalTimeline.items.some((item) => item.sourceId === otherActivity.id), false, "other Organization work is isolated");
    const activityTime = new Date(leadActivity.occurredAt);
    const activityFrom = new Date(activityTime.getTime() - 1_000).toISOString();
    const activityAt = activityTime.toISOString();
    const activityAfter = new Date(activityTime.getTime() + 1_000).toISOString();
    assert.equal((await timeline.list(converted.organizationId!, { page: 1, pageSize: 100, dateFrom: activityFrom, dateTo: activityAfter })).items.some((item) => item.id === `activity:${leadActivity.id}`), true, "dateFrom is inclusive and the exclusive dateTo includes earlier events");
    assert.equal((await timeline.list(converted.organizationId!, { page: 1, pageSize: 100, dateFrom: activityFrom, dateTo: activityAt })).items.some((item) => item.id === `activity:${leadActivity.id}`), false, "dateTo is exclusive");
    assert.equal((await timeline.list(converted.organizationId!, { page: 1, pageSize: 20, dateFrom: new Date(Date.now() + 3_600_000).toISOString(), dateTo: new Date(Date.now() + 7_200_000).toISOString() })).total, 0);
    await assert.rejects(timeline.list(converted.organizationId!, { page: 1, pageSize: 20, dateFrom: new Date(Date.now() + 7_200_000).toISOString(), dateTo: new Date(Date.now() + 3_600_000).toISOString() }), { status: 400 });
    const tieTime = new Date(leadActivity.occurredAt).toISOString();
    await dataSource.query("UPDATE crm_notes SET created_at=$2 WHERE id=$1", [leadNote.id, tieTime]);
    const tiedFirst = await timeline.list(converted.organizationId!, { page: 1, pageSize: 100 });
    const tiedAgain = await timeline.list(converted.organizationId!, { page: 1, pageSize: 100 });
    assert.deepEqual(tiedAgain.items.map((item) => item.id), tiedFirst.items.map((item) => item.id), "equal timestamps have stable ordering");
    const tiedEvents = tiedFirst.items.filter((item) => new Date(item.occurredAt).getTime() === new Date(tieTime).getTime());
    assert.equal(tiedEvents.length >= 2, true);
    assert.deepEqual(tiedEvents.map((item) => item.category), [...tiedEvents.map((item) => item.category)].sort(), "ties use a deterministic category and ID sort");
    const afterCompletion = await organization360.overview(converted.organizationId!);
    assert.equal(afterCompletion.summary.openTaskCount, 0);
    assert.equal(afterCompletion.summary.nextTask, null);
    await assert.rejects(tasks.complete(leadTask.id, actorId), { status: 409 });
    await tasks.archive(leadTask.id, actorId);
    assert.ok((await tasks.get(leadTask.id)).archivedAt);
    assert.equal((await tasks.restore(leadTask.id, actorId)).archivedAt, null);

    const editedNote = await notes.update(leadNote.id, { body: `${marker}-edited` }, actorId);
    assert.equal(editedNote.body, `${marker}-edited`);
    assert.equal(editedNote.updatedByUserId, actorId);
    await notes.archive(leadNote.id, actorId);
    assert.ok((await notes.get(leadNote.id)).archivedAt);
    assert.equal((await notes.restore(leadNote.id, actorId)).archivedAt, null);
    const updatedTimeline = await timeline.list(converted.organizationId!, { page: 1, pageSize: 100 });
    assert.equal(updatedTimeline.items.filter((item) => item.sourceType === "NOTE" && item.sourceId === leadNote.id).length, 1);
    assert.equal(updatedTimeline.items.some((item) => item.description === `${marker}-edited`), true, "a Note timeline item reflects its current source content");
    await activities.archive(activity.id, actorId);
    assert.ok((await activities.get(activity.id)).archivedAt);
    assert.equal((await timeline.list(organization.id, { page: 1, pageSize: 100 })).items.some((item) => item.id === `activity:${activity.id}`), true, "archived Activities remain readable in Timeline");
    assert.equal((await activities.restore(activity.id, actorId)).archivedAt, null);
    await crm.archiveOrganization(organization.id, actorId);
    assert.ok((await crm.getOrganization(organization.id)).archivedAt);
    assert.ok((await timeline.list(organization.id, { page: 1, pageSize: 100 })).items.length, "archived Organizations retain their historical Timeline");
    assert.ok((await organization360.overview(organization.id)).summary);
    await crm.restoreOrganization(organization.id, actorId);

    const auditRows = await dataSource.query<Array<{ action: string; summary: Record<string, unknown> }>>(
      "SELECT action,summary FROM platform_audit_events WHERE target_id=ANY($1::text[])", [[...activityIds, ...taskIds, ...noteIds]],
    );
    assert.ok(auditRows.some((row) => row.action === "crm.task.completed"));
    assert.equal(auditRows.some((row) => JSON.stringify(row.summary).includes(marker)), false, "audit summaries must omit work content");
  } finally {
    if (dataSource.isInitialized) {
      const targetIds = [...activityIds, ...taskIds, ...noteIds, ...dealIds, ...leadIds, ...organizationIds, ...contactIds];
      if (targetIds.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [targetIds]);
      if (activityIds.length) await dataSource.query("DELETE FROM crm_activities WHERE id=ANY($1::uuid[])", [activityIds]);
      if (noteIds.length) await dataSource.query("DELETE FROM crm_notes WHERE id=ANY($1::uuid[])", [noteIds]);
      if (taskIds.length) await dataSource.query("DELETE FROM crm_tasks WHERE id=ANY($1::uuid[])", [taskIds]);
      if (dealIds.length) {
        await dataSource.query("DELETE FROM crm_deal_stage_history WHERE deal_id=ANY($1::uuid[])", [dealIds]);
        await dataSource.query("DELETE FROM crm_deals WHERE id=ANY($1::uuid[])", [dealIds]);
      }
      if (leadIds.length) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=ANY($1::uuid[])", [leadIds]);
      }
      if (contactIds.length) await dataSource.query("DELETE FROM crm_contacts WHERE id=ANY($1::uuid[])", [contactIds]);
      if (organizationIds.length) await dataSource.query("DELETE FROM crm_organizations WHERE id=ANY($1::uuid[])", [organizationIds]);
      await dataSource.destroy();
    }
  }
});
