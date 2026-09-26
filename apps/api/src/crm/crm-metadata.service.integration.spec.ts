import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmFilterService } from "./crm-filter.service";
import { CrmMetadataService } from "./crm-metadata.service";
import { CrmSavedViewService } from "./crm-saved-view.service";
import { CrmSegmentService } from "./crm-segment.service";
import { CrmService } from "./crm.service";
import { CrmCustomFieldEntityType, CrmCustomFieldType } from "./entities/crm-custom-field.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;

test("CRM metadata validates and retains fields/Tags while saved views and Segments query live records", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const fieldIds: string[] = [];
  const tagIds: string[] = [];
  const segmentIds: string[] = [];
  const viewIds: string[] = [];
  let organizationId = "";
  let actorId = "";
  let marker = "";
  try {
    await dataSource.initialize();
    const actors = await dataSource.query<Array<{ id: string }>>(`
      SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND EXISTS (
        SELECT 1 FROM user_platform_roles upr JOIN roles r ON r.id=upr.role_id AND r.scope='PLATFORM'
        JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
        WHERE upr.user_id=u.id AND p.key='crm.manage'
      ) ORDER BY u.created_at LIMIT 1
    `);
    assert.ok(actors[0], "CRM metadata integration test requires an active CRM manager");
    actorId = actors[0].id;
    marker = `crm-metadata-${randomUUID()}`;
    const key = `crm_metadata_${randomUUID().replaceAll("-", "")}`;
    const filters = new CrmFilterService(dataSource);
    const crypto = new AuthCryptoService(new ConfigService({ AUTH_PEPPER: "crm-metadata-test-pepper-long-enough", PII_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64") }));
    const crm = new CrmService(dataSource, crypto, filters);
    const metadata = new CrmMetadataService(dataSource);
    const views = new CrmSavedViewService(dataSource, filters);
    const segments = new CrmSegmentService(dataSource, filters);
    const organization = await crm.createOrganization({ name: marker }, actorId);
    organizationId = organization.id;

    const field = await metadata.createField({ entityType: CrmCustomFieldEntityType.Organization, key, label: "ارزش تجاری", dataType: CrmCustomFieldType.Text, required: true }, actorId) as unknown as { id: string };
    fieldIds.push(field.id);
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, {}, actorId);
    await assert.rejects(metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [key]: null }, actorId), { status: 400 });

    const selectField = await metadata.createField({ entityType: CrmCustomFieldEntityType.Organization, key: `${key}_kind`, label: "دسته", dataType: CrmCustomFieldType.SingleSelect, options: [{ label: "اولیه" }] }, actorId) as { id: string; options: { id: string }[] };
    fieldIds.push(selectField.id);
    const stableOptionId = selectField.options[0]!.id as string;
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [`${key}_kind`]: stableOptionId }, actorId);
    await metadata.updateField(selectField.id, { options: [{ id: stableOptionId, label: "به‌روزشده", active: true }] }, actorId);
    assert.equal((await metadata.getRecordFields(CrmCustomFieldEntityType.Organization, organizationId)).fields.find((item) => item.key === `${key}_kind`)?.options[0]?.label, "به‌روزشده");
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [key]: "High" }, actorId);
    await assert.rejects(metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [key]: 4 }, actorId), { status: 400 });

    const multiKey = `${key}_multi`;
    const multiField = await metadata.createField({ entityType: CrmCustomFieldEntityType.Organization, key: multiKey, label: "ویژگی‌ها", dataType: CrmCustomFieldType.MultiSelect, options: [{ label: "الف" }, { label: "ب" }] }, actorId) as unknown as { id: string; options: { id: string }[] };
    fieldIds.push(multiField.id);
    const multiOptionIds = multiField.options.map((option) => option.id);
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [multiKey]: multiOptionIds }, actorId);
    const multiFiltered = await crm.listOrganizations({ q: marker, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC", page: 1, pageSize: 10, filter: JSON.stringify({ version: 1, logic: "AND", conditions: [{ field: `custom:${multiKey}`, operator: "containsAll", value: multiOptionIds }] }) });
    assert.equal(multiFiltered.items[0]?.id, organizationId, "Multi-select containsAll filters persisted option IDs");

    const typedValues: { key: string; dataType: CrmCustomFieldType; valid: unknown; invalid: unknown }[] = [
      { key: `${key}_number`, dataType: CrmCustomFieldType.Number, valid: 4.5, invalid: "4.5" },
      { key: `${key}_boolean`, dataType: CrmCustomFieldType.Boolean, valid: true, invalid: "true" },
      { key: `${key}_date`, dataType: CrmCustomFieldType.Date, valid: "2026-09-26", invalid: "2026-02-30" },
      { key: `${key}_url`, dataType: CrmCustomFieldType.Url, valid: "https://example.com", invalid: "javascript:alert(1)" },
      { key: `${key}_long`, dataType: CrmCustomFieldType.LongText, valid: "A longer note", invalid: 7 },
    ];
    for (const item of typedValues) {
      const definition = await metadata.createField({ entityType: CrmCustomFieldEntityType.Organization, key: item.key, label: item.key, dataType: item.dataType }, actorId) as unknown as { id: string };
      fieldIds.push(definition.id);
      await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [item.key]: item.valid }, actorId);
      await assert.rejects(metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [item.key]: item.invalid }, actorId), { status: 400 });
    }

    const tag = await metadata.createTag({ name: marker, color: "blue" }, actorId);
    tagIds.push(tag.id);
    await assert.rejects(metadata.createTag({ name: marker.toUpperCase(), color: "red" }, actorId), { status: 409 });
    await metadata.setRecordTags(CrmCustomFieldEntityType.Organization, organizationId, [tag.id], actorId);
    const tagged = await crm.listOrganizations({ q: marker, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC", page: 1, pageSize: 10, filter: JSON.stringify({ version: 1, logic: "AND", conditions: [{ field: "tags", operator: "containsAny", value: [tag.id] }] }) });
    assert.equal(tagged.items[0]?.id, organizationId);
    const filterDefinition = { version: 1, logic: "AND", conditions: [{ field: `custom:${key}`, operator: "equals", value: "High" }] };
    const filtered = await crm.listOrganizations({ q: marker, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC", page: 1, pageSize: 10, filter: JSON.stringify(filterDefinition) });
    assert.equal(filtered.items[0]?.id, organizationId);

    const segment = await segments.create({ name: marker, entityType: CrmCustomFieldEntityType.Organization, filterDefinition }, actorId);
    if (!segment) throw new Error("Segment creation returned no row");
    const segmentId = segment.id as string;
    segmentIds.push(segmentId);
    assert.equal((await segments.preview(segmentId)).count, 1);
    const view = await views.create({ name: marker, entityType: CrmCustomFieldEntityType.Organization, visibility: "PRIVATE", filterDefinition, queryDefinition: { q: marker }, sortDefinition: { field: "createdAt", direction: "DESC" } }, actorId) as unknown as { id: string };
    const viewId = view.id;
    viewIds.push(viewId);
    assert.equal(((await views.list(CrmCustomFieldEntityType.Organization, actorId)) as unknown as Array<{ id: string }>).some((item) => item.id === viewId), true);
    assert.equal(((await views.list(CrmCustomFieldEntityType.Organization, randomUUID())) as unknown as Array<{ id: string }>).some((item) => item.id === viewId), false);
    await views.update(viewId, { name: `${marker} updated`, visibility: "SHARED" }, actorId);
    assert.equal(((await views.list(CrmCustomFieldEntityType.Organization, randomUUID())) as unknown as Array<{ id: string; name: string }>).find((item) => item.id === viewId)?.name, `${marker} updated`);

    await metadata.updateRecordFields(CrmCustomFieldEntityType.Organization, organizationId, { [key]: "Low" }, actorId);
    assert.equal((await segments.preview(segmentId)).count, 0, "Segment membership is recalculated from current values");
    await metadata.archiveField(field.id, actorId);
    assert.equal((await metadata.getRecordFields(CrmCustomFieldEntityType.Organization, organizationId)).values[key], "Low", "Archived fields retain their existing value");
    assert.equal((await segments.get(segmentId)).criteriaValid, false);
    await metadata.archiveTag(tag.id, actorId);
    assert.equal((await metadata.getRecordTags(CrmCustomFieldEntityType.Organization, organizationId)).some((item) => item.id === tag.id), true, "Archived tags retain record assignments");
    const withoutActiveTags = await crm.listOrganizations({ q: marker, archiveStatus: "ACTIVE", sort: "createdAt", direction: "DESC", page: 1, pageSize: 10, filter: JSON.stringify({ version: 1, logic: "AND", conditions: [{ field: "tags", operator: "isEmpty" }] }) });
    assert.equal(withoutActiveTags.items[0]?.id, organizationId, "Archived tag assignments do not count as active tags");
  } finally {
    if (dataSource.isInitialized) {
      const metadataIds = [...segmentIds, ...viewIds];
      if (metadataIds.length) {
        await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [metadataIds]);
        if (segmentIds.length) await dataSource.query("DELETE FROM crm_segments WHERE id=ANY($1::uuid[])", [segmentIds]);
        if (viewIds.length) await dataSource.query("DELETE FROM crm_saved_views WHERE id=ANY($1::uuid[])", [viewIds]);
      }
      const auditIds = [...fieldIds, ...tagIds, ...(organizationId ? [organizationId] : [])];
      if (auditIds.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [auditIds]);
      if (organizationId) await dataSource.query("DELETE FROM crm_entity_tags WHERE organization_id=$1", [organizationId]);
      if (tagIds.length) await dataSource.query("DELETE FROM crm_tags WHERE id=ANY($1::uuid[])", [tagIds]);
      if (fieldIds.length) {
        await dataSource.query("DELETE FROM crm_custom_field_options WHERE field_definition_id=ANY($1::uuid[])", [fieldIds]);
        await dataSource.query("DELETE FROM crm_custom_field_definitions WHERE id=ANY($1::uuid[])", [fieldIds]);
      }
      if (organizationId) {
        await dataSource.query("DELETE FROM crm_organizations WHERE id=$1", [organizationId]);
      }
      await dataSource.destroy();
    }
  }
});
