import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmContact, CrmLead, CrmLeadStatusHistory, CrmOrganization } from "./entities";
import { CrmService } from "./crm.service";
import { CrmLeadPriority, CrmLeadSource, CrmLeadStatus, CrmLeadUnqualifiedReason } from "./entities/crm-lead.entity";
import { CrmLeadService } from "./crm-lead.service";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;
const entities = [CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory];
const cryptoConfig = {
  AUTH_PEPPER: "crm-lead-integration-test-pepper-value-long-enough",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 11).toString("base64"),
};

test("CRM Lead lifecycle, duplicates, conversion, history, archive, and linking persist in PostgreSQL", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, entities, synchronize: false, migrationsRun: false });
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
    assert.ok(actors[0], "CRM Lead integration test requires an active CRM manager");
    actorId = actors[0].id;
    const crypto = new AuthCryptoService(new ConfigService(cryptoConfig));
    const leads = new CrmLeadService(dataSource, crypto);
    const crm = new CrmService(dataSource, crypto);
    const marker = `crm-lead-test-${randomUUID()}`;

    const lead = await leads.create({
      businessName: `${marker}-new`, contactName: "Sara Manager", phone: "09121234567", email: `${marker}@example.com`,
      city: "Tehran", source: CrmLeadSource.Manual, priority: CrmLeadPriority.High,
    }, actorId);
    leadIds.push(lead.id);
    assert.equal(lead.status, CrmLeadStatus.New);
    assert.equal(lead.phone, "+989121234567");
    assert.notEqual((await dataSource.query<Array<{ phone_encrypted: string }>>("SELECT phone_encrypted FROM crm_leads WHERE id=$1", [lead.id]))[0]?.phone_encrypted, lead.phone);
    await assert.rejects(leads.changeStatus(lead.id, { status: CrmLeadStatus.Converted } as never, actorId), { status: 409 });
    await assert.rejects(leads.qualify(lead.id, {}, actorId), { status: 409 });
    await leads.changeStatus(lead.id, { status: CrmLeadStatus.Contacted }, actorId);
    const qualified = await leads.qualify(lead.id, { qualificationNotes: "Operating cafe; decision maker reached." }, actorId);
    assert.equal(qualified.status, CrmLeadStatus.Qualified);
    assert.ok(qualified.qualifiedAt);

    const converted = await leads.convert(lead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId);
    organizationIds.push(converted.organizationId!);
    contactIds.push(converted.primaryContactId!);
    assert.equal(converted.status, CrmLeadStatus.Converted);
    assert.ok(converted.convertedAt);
    assert.equal(converted.primaryContact?.name, "Sara Manager");
    const historyCount = Number((await dataSource.query<Array<{ count: string }>>("SELECT count(*)::text AS count FROM crm_lead_status_history WHERE lead_id=$1", [lead.id]))[0]?.count ?? 0);
    assert.equal(historyCount, 4);
    const retried = await leads.convert(lead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId);
    assert.equal(retried.organizationId, converted.organizationId);
    assert.equal(retried.primaryContactId, converted.primaryContactId);
    assert.equal(Number((await dataSource.query<Array<{ count: string }>>("SELECT count(*)::text AS count FROM crm_lead_status_history WHERE lead_id=$1", [lead.id]))[0]?.count ?? 0), historyCount);
    await assert.rejects(leads.unqualify(lead.id, { reason: CrmLeadUnqualifiedReason.Other }, actorId), { status: 409 });

    await assert.rejects(leads.create({
      businessName: `${marker}-duplicate`, contactName: "Other name", phone: "09121234567", email: `${marker}-other@example.com`,
      city: "Mashhad", source: CrmLeadSource.Manual,
    }, actorId), (error: { status?: number; response?: { candidates?: unknown[] } }) => error.status === 409 && (error.response?.candidates?.length ?? 0) > 0);

    const existingOrganization = await crm.createOrganization({ name: `${marker}-existing`, city: "Shiraz" }, actorId);
    organizationIds.push(existingOrganization.id);
    const existingContact = await crm.createContact(existingOrganization.id, { name: "Existing Contact", role: "Owner", phone: "09129876543", email: `${marker}-contact@example.com` }, actorId);
    contactIds.push(existingContact.id);
    const linkedLead = await leads.create({
      businessName: `${marker}-existing`, contactName: "Existing Contact", phone: "09129876543", email: `${marker}-contact@example.com`, city: "Shiraz",
      source: CrmLeadSource.Referral, organizationId: existingOrganization.id, primaryContactId: existingContact.id, allowPotentialDuplicates: true,
    }, actorId);
    leadIds.push(linkedLead.id);
    await leads.changeStatus(linkedLead.id, { status: CrmLeadStatus.Contacted }, actorId);
    await leads.qualify(linkedLead.id, {}, actorId);
    await assert.rejects(leads.convert(linkedLead.id, { organizationMode: "CREATE", contactMode: "CREATE" }, actorId), { status: 409 });
    await assert.rejects(leads.convert(linkedLead.id, { organizationMode: "LINK", organizationId: existingOrganization.id, contactMode: "CREATE" }, actorId), { status: 409 });
    assert.equal((await leads.get(linkedLead.id) as unknown as { status: string }).status, CrmLeadStatus.Qualified);
    const linked = await leads.convert(linkedLead.id, { organizationMode: "LINK", organizationId: existingOrganization.id, contactMode: "LINK", contactId: existingContact.id }, actorId);
    assert.equal(linked.organizationId, existingOrganization.id);
    assert.equal(linked.primaryContactId, existingContact.id);

    await leads.archive(linkedLead.id, actorId);
    assert.equal((await leads.list({ page: 1, pageSize: 20, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC" })).items.some((item) => item.id === linkedLead.id), false);
    assert.equal((await leads.list({ page: 1, pageSize: 20, archiveStatus: "ARCHIVED", sort: "createdAt", direction: "DESC" })).items.some((item) => item.id === linkedLead.id), true);
    assert.equal((await leads.get(linkedLead.id) as unknown as { organizationId: string }).organizationId, existingOrganization.id);
  } finally {
    if (dataSource.isInitialized) {
      const targets = [...leadIds, ...organizationIds, ...contactIds];
      if (targets.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id = ANY($1::text[])", [targets]);
      if (leadIds.length) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id = ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_leads WHERE id = ANY($1::uuid[])", [leadIds]);
      }
      if (contactIds.length) await dataSource.query("DELETE FROM crm_contacts WHERE id = ANY($1::uuid[])", [contactIds]);
      if (organizationIds.length) await dataSource.query("DELETE FROM crm_organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
      await dataSource.destroy();
    }
  }
});

test("public consultation to CRM Lead writes roll back with the intake transaction", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, entities, synchronize: false, migrationsRun: false });
  const requestId = randomUUID();
  let createdLeadId: string | null = null;
  try {
    await dataSource.initialize();
    const crypto = new AuthCryptoService(new ConfigService(cryptoConfig));
    const leads = new CrmLeadService(dataSource, crypto);
    await assert.rejects(dataSource.transaction(async (manager) => {
      await manager.query(`
        INSERT INTO platform_order_requests (id,contact_name,coffee_shop_name,phone_encrypted,phone_hash,city,business_stage,requested_services,status,source)
        VALUES ($1,'Test Contact','Rollback Cafe',$2,$3,'Tehran','OPERATING',ARRAY['CONSULTATION']::platform_order_service[],'NEW','platform_landing')
      `, [requestId, crypto.encryptPii("+989121234567"), crypto.hashPhone("+989121234567")]);
      await leads.createFromRequest(manager, { id: requestId, businessName: "Rollback Cafe", contactName: "Test Contact", phone: "+989121234567", city: "Tehran", description: null });
      throw new Error("force transaction rollback");
    }), /force transaction rollback/);
    assert.equal((await dataSource.query<Array<{ count: string }>>("SELECT count(*)::text AS count FROM platform_order_requests WHERE id=$1", [requestId]))[0]?.count, "0");
    assert.equal((await dataSource.query<Array<{ count: string }>>("SELECT count(*)::text AS count FROM crm_leads WHERE source_request_id=$1", [requestId]))[0]?.count, "0");

    const [first, retry] = await dataSource.transaction(async (manager) => {
      await manager.query(`
        INSERT INTO platform_order_requests (id,contact_name,coffee_shop_name,phone_encrypted,phone_hash,city,business_stage,requested_services,status,source)
        VALUES ($1,'Test Contact','Idempotent Cafe',$2,$3,'Tehran','OPERATING',ARRAY['CONSULTATION']::platform_order_service[],'NEW','platform_landing')
      `, [requestId, crypto.encryptPii("+989121234567"), crypto.hashPhone("+989121234567")]);
      const input = { id: requestId, businessName: "Idempotent Cafe", contactName: "Test Contact", phone: "+989121234567", city: "Tehran", description: null };
      return [await leads.createFromRequest(manager, input), await leads.createFromRequest(manager, input)];
    });
    createdLeadId = first;
    assert.equal(retry, first);
    assert.equal((await dataSource.query<Array<{ count: string }>>("SELECT count(*)::text AS count FROM crm_leads WHERE source_request_id=$1", [requestId]))[0]?.count, "1");
  } finally {
    if (dataSource.isInitialized) {
      if (createdLeadId) {
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=$1", [createdLeadId]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=$1", [createdLeadId]);
      }
      await dataSource.query("DELETE FROM platform_order_requests WHERE id=$1", [requestId]);
      await dataSource.destroy();
    }
  }
});
