import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { SubscriptionPlan } from "../subscriptions/entities/subscription-plan.entity";
import { CrmDeal, CrmDealStageHistory, CrmContact, CrmLead, CrmLeadStatusHistory, CrmOrganization } from "./entities";
import { CrmService } from "./crm.service";
import { CrmDealService } from "./crm-deal.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmLeadSource } from "./entities/crm-lead.entity";
import { CrmDealLossReason, CrmDealStage, CrmDealStatus } from "./entities/crm-deal.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;
const entities = [CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory, CrmDeal, CrmDealStageHistory, SubscriptionPlan];
const cryptoConfig = {
  AUTH_PEPPER: "crm-deal-integration-test-pepper-value-long-enough",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
};

test("CRM Deal creation, relations, stage history, outcomes, filters, and archive persist in PostgreSQL", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, entities, synchronize: false, migrationsRun: false });
  const dealIds: string[] = [];
  const leadIds: string[] = [];
  const organizationIds: string[] = [];
  const contactIds: string[] = [];
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
    assert.ok(actors[0], "CRM Deal integration test requires an active CRM manager");
    actorId = actors[0].id;
    const crypto = new AuthCryptoService(new ConfigService(cryptoConfig));
    const crm = new CrmService(dataSource, crypto);
    const leads = new CrmLeadService(dataSource, crypto);
    const deals = new CrmDealService(dataSource, leads);
    const marker = `crm-deal-test-${randomUUID()}`;

    const lead = await leads.create({ businessName: `${marker}-converted`, contactName: "Sara Manager", source: CrmLeadSource.Manual }, actorId);
    leadIds.push(lead.id);
    await leads.changeStatus(lead.id, { status: "CONTACTED" as never }, actorId);
    await leads.qualify(lead.id, {}, actorId);
    const converted = await leads.convert(lead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId);
    organizationIds.push(converted.organizationId!);
    contactIds.push(converted.primaryContactId!);

    const organization = await crm.createOrganization({ name: `${marker}-other` }, actorId);
    organizationIds.push(organization.id);
    const contact = await crm.createContact(organization.id, { name: "Another Contact" }, actorId);
    contactIds.push(contact.id);
    await assert.rejects(deals.create({ title: "Wrong organization contact", organizationId: organization.id, primaryContactId: converted.primaryContactId }, actorId), { status: 400 });

    const plans = await dataSource.query<Array<{ id: string }>>("SELECT id FROM subscription_plans WHERE status='ACTIVE' ORDER BY sort_order LIMIT 1");
    const deal = await deals.create({
      title: `${marker} initial subscription`, organizationId: converted.organizationId!, primaryContactId: converted.primaryContactId!,
      originatingLeadId: lead.id, ownerId: actorId, expectedPlanId: plans[0]?.id, estimatedAmountToman: "1900000",
      expectedCloseDate: "2026-08-01", stage: CrmDealStage.DemoCompleted,
    }, actorId);
    dealIds.push(deal.id);
    assert.equal(deal.stage, CrmDealStage.DemoCompleted);
    assert.equal(deal.status, CrmDealStatus.Open);
    assert.equal(deal.organizationId, converted.organizationId);
    assert.equal(deal.primaryContactId, converted.primaryContactId);
    assert.equal(deal.originatingLeadId, lead.id);
    assert.equal(deal.estimatedAmountToman, "1900000");
    assert.equal(deal.stageHistory.length, 1);
    assert.equal(deal.stageHistory[0]!.fromStage, null);

    await assert.rejects(deals.create({ title: "Duplicate lead deal", organizationId: converted.organizationId!, originatingLeadId: lead.id }, actorId), { status: 409 });
    const qualifiedLead = await leads.create({ businessName: `${marker}-qualified`, contactName: "Sara Manager", source: CrmLeadSource.Manual, organizationId: converted.organizationId!, primaryContactId: converted.primaryContactId! }, actorId);
    leadIds.push(qualifiedLead.id);
    await leads.changeStatus(qualifiedLead.id, { status: "CONTACTED" as never }, actorId);
    await leads.qualify(qualifiedLead.id, {}, actorId);
    const qualifiedDeal = await deals.create({ title: `${marker} qualified opportunity`, organizationId: converted.organizationId!, originatingLeadId: qualifiedLead.id }, actorId);
    dealIds.push(qualifiedDeal.id);
    assert.equal(qualifiedDeal.originatingLeadId, qualifiedLead.id);

    const moved = await deals.changeStage(deal.id, { expectedStage: CrmDealStage.DemoCompleted, stage: CrmDealStage.TrialProposed }, actorId);
    assert.equal(moved.stage, CrmDealStage.TrialProposed);
    await assert.rejects(deals.changeStage(deal.id, { expectedStage: CrmDealStage.DemoCompleted, stage: CrmDealStage.TrialActive, reason: "stale" }, actorId), { status: 409 });
    await assert.rejects(deals.changeStage(deal.id, { expectedStage: CrmDealStage.TrialProposed, stage: CrmDealStage.Discovery }, actorId), { status: 400 });
    const corrected = await deals.changeStage(deal.id, { expectedStage: CrmDealStage.TrialProposed, stage: CrmDealStage.Discovery, reason: "Prospect asked for a fresh walkthrough" }, actorId);
    assert.equal(corrected.stageHistory.length, 3);
    assert.equal(corrected.stageHistory[2]!.actorLabel?.startsWith("اپراتور"), true);
    const updated = await deals.update(deal.id, { estimatedAmountToman: null, expectedCloseDate: null, ownerId: null }, actorId);
    assert.equal(updated.estimatedAmountToman, null);
    assert.equal(updated.expectedCloseDate, null);

    const manual = await deals.create({ title: `${marker} second opportunity`, organizationId: organization.id, primaryContactId: contact.id }, actorId);
    dealIds.push(manual.id);
    const won = await deals.win(manual.id, actorId);
    assert.equal(won.status, CrmDealStatus.Won);
    assert.ok(won.wonAt);
    await assert.rejects(deals.win(manual.id, actorId), { status: 409 });

    const lost = await deals.create({ title: `${marker} lost opportunity`, organizationId: organization.id }, actorId);
    dealIds.push(lost.id);
    const closedLost = await deals.lose(lost.id, { reason: CrmDealLossReason.Other, detail: "Moved to another platform" }, actorId);
    assert.equal(closedLost.status, CrmDealStatus.Lost);
    assert.equal(closedLost.lossReason, CrmDealLossReason.Other);
    assert.equal(closedLost.lossReasonDetail, "Moved to another platform");
    assert.ok(closedLost.lostAt);
    await assert.rejects(deals.lose(lost.id, { reason: CrmDealLossReason.Price }, actorId), { status: 409 });

    const active = await deals.list({ page: 1, pageSize: 100, status: CrmDealStatus.Open, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC" });
    assert.equal(active.items.some((item) => item.id === deal.id), true);
    assert.equal(active.stageTotals.some((item) => item.stage === CrmDealStage.Discovery && item.count >= 1), true);
    await deals.archive(deal.id, actorId);
    assert.equal((await deals.list({ page: 1, pageSize: 100, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC" })).items.some((item) => item.id === deal.id), false);
    assert.equal((await deals.list({ page: 1, pageSize: 100, archiveStatus: "ARCHIVED", sort: "createdAt", direction: "DESC" })).items.some((item) => item.id === deal.id), true);
    await deals.restore(deal.id, actorId);
    assert.equal((await deals.get(deal.id)).stageHistory.length, 3);
    assert.equal((await leads.get(lead.id) as unknown as { organizationId: string }).organizationId, converted.organizationId);
  } finally {
    if (dataSource.isInitialized) {
      const targetIds = [...dealIds, ...leadIds, ...organizationIds, ...contactIds];
      if (targetIds.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [targetIds]);
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
