import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmContact, CrmOrganization } from "./entities";
import { CrmService } from "./crm.service";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;

test("CRM organization/contact persistence, duplicate candidates, PII projection, archive, and Tenant constraints", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, entities: [CrmOrganization, CrmContact], synchronize: false, migrationsRun: false });
  const organizationIds: string[] = [];
  const contactIds: string[] = [];
  let actorId = "";
  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>("SELECT id FROM users WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1");
    assert.ok(actors[0], "CRM integration test requires an existing platform user for audit attribution");
    actorId = actors[0].id;
    const permissions = await dataSource.query<Array<{ key: string; assigned: boolean }>>(`
      SELECT p.key, bool_or(r.key='platform_owner' AND r.scope='PLATFORM' AND rp.role_id IS NOT NULL) AS assigned
      FROM permissions p LEFT JOIN role_permissions rp ON rp.permission_id=p.id LEFT JOIN roles r ON r.id=rp.role_id
      WHERE p.key IN ('crm.read', 'crm.manage') GROUP BY p.key ORDER BY p.key
    `);
    assert.deepEqual(permissions.map((row) => [row.key, row.assigned]), [["crm.manage", true], ["crm.read", true]]);
    const service = new CrmService(dataSource, new AuthCryptoService(new ConfigService({
      AUTH_PEPPER: "crm-integration-test-pepper-value-long-enough",
      PII_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
    })));
    const marker = `crm-test-${crypto.randomUUID()}`;

    const organization = await service.createOrganization({ name: marker, city: "Tehran", website: "WWW.Example.com/?utm_source=test", instagram: "@crm.test", coffeeShopId: null }, actorId);
    organizationIds.push(organization.id);
    assert.equal(organization.website, "https://www.example.com");
    assert.equal(organization.instagram, "crm.test");
    const candidates = await service.organizationDuplicateCandidates({ name: ` ${marker.toUpperCase()} `, city: "TEHRAN", website: "https://www.example.com", instagram: "https://instagram.com/crm.test/" });
    assert.equal(candidates[0]?.id, organization.id);
    assert.deepEqual(candidates[0]?.matchingFields, ["name_city", "website", "instagram"]);
    const search = await service.listOrganizations({ page: 1, pageSize: 10, q: marker, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC" });
    assert.equal(search.items[0]?.id, organization.id);

    const contact = await service.createContact(organization.id, { name: "Sara Manager", role: "Manager", phone: "09121234567", email: "Owner@Example.com" }, actorId);
    contactIds.push(contact.id);
    const secondContact = await service.createContact(organization.id, { name: "Ali Owner", role: "Owner" }, actorId);
    contactIds.push(secondContact.id);
    assert.equal((await service.listContacts({ organizationId: organization.id, page: 1, pageSize: 10, archiveStatus: "ACTIVE", sort: "name", direction: "ASC" })).total, 2);
    assert.equal(contact.phone, "+989121234567");
    assert.equal(contact.email, "owner@example.com");
    const stored = (await dataSource.query<Array<{ phone_encrypted: string; email_encrypted: string }>>("SELECT phone_encrypted, email_encrypted FROM crm_contacts WHERE id=$1", [contact.id]))[0]!;
    assert.notEqual(stored.phone_encrypted, contact.phone);
    assert.notEqual(stored.email_encrypted, contact.email);
    const contactCandidates = await service.contactDuplicateCandidates(organization.id, { phone: "00989121234567", email: "owner@example.com" });
    assert.deepEqual(contactCandidates[0]?.matchingFields, ["phone", "email"]);
    const contactSearch = await service.listContacts({ organizationId: organization.id, q: "owner@example.com", page: 1, pageSize: 10, archiveStatus: "ACTIVE", sort: "name", direction: "ASC" });
    assert.equal(contactSearch.items[0]?.id, contact.id);
    assert.equal("phone" in contactSearch.items[0]!, false);
    const updated = await service.updateContact(contact.id, { role: "مالک", email: null }, actorId);
    assert.equal(updated.role, "مالک");
    assert.equal(updated.email, null);

    const tenants = await dataSource.query<Array<{ id: string }>>("SELECT id FROM coffee_shops WHERE deleted_at IS NULL ORDER BY created_at LIMIT 1");
    if (tenants[0]) {
      const linked = await service.createOrganization({ name: `${marker}-linked`, coffeeShopId: tenants[0].id }, actorId);
      organizationIds.push(linked.id);
      assert.equal((await service.listTenantLinkCandidates()).some((tenant) => tenant.id === tenants[0]!.id), false);
      assert.equal((await service.listTenantLinkCandidates(linked.id)).some((tenant) => tenant.id === tenants[0]!.id), true);
      await assert.rejects(service.createOrganization({ name: `${marker}-second-link`, coffeeShopId: tenants[0].id }, actorId), { status: 409 });
    }
    await assert.rejects(service.createContact(crypto.randomUUID(), { name: "Invalid parent" }, actorId), { status: 404 });

    await service.archiveOrganization(organization.id, actorId);
    assert.equal((await service.getOrganization(organization.id)).archivedAt != null, true);
    assert.equal((await service.listContacts({ organizationId: organization.id, page: 1, pageSize: 10, archiveStatus: "ACTIVE", sort: "name", direction: "ASC" })).total, 2);
    await service.archiveContact(contact.id, actorId);
    assert.equal((await service.listContacts({ organizationId: organization.id, page: 1, pageSize: 10, archiveStatus: "ACTIVE", sort: "name", direction: "ASC" })).total, 1);
    assert.equal((await service.listContacts({ organizationId: organization.id, page: 1, pageSize: 10, archiveStatus: "ARCHIVED", sort: "name", direction: "ASC" })).total, 1);
    await service.restoreOrganization(organization.id, actorId);
    await service.restoreContact(contact.id, actorId);
    assert.equal((await service.getContact(contact.id)).phone, "+989121234567");
  } finally {
    if (dataSource.isInitialized) {
      if (actorId && (organizationIds.length || contactIds.length)) {
        const targetIds = [...organizationIds, ...contactIds];
        await dataSource.query("DELETE FROM platform_audit_events WHERE target_id = ANY($1::text[])", [targetIds]);
      }
      if (contactIds.length) await dataSource.query("DELETE FROM crm_contacts WHERE id = ANY($1::uuid[])", [contactIds]);
      if (organizationIds.length) await dataSource.query("DELETE FROM crm_organizations WHERE id = ANY($1::uuid[])", [organizationIds]);
      await dataSource.destroy();
    }
  }
});
