import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { CrmFilterService } from "./crm-filter.service";
import { CrmLeadService } from "./crm-lead.service";
import { CrmMetadataService } from "./crm-metadata.service";
import { CrmSavedViewService } from "./crm-saved-view.service";
import { CrmSegmentService } from "./crm-segment.service";
import { CrmScoringService } from "./crm-scoring.service";
import { CrmScoringCategory } from "./crm-scoring.util";
import { CrmLeadPriority, CrmLeadSource } from "./entities/crm-lead.entity";
import { CrmCustomFieldEntityType, CrmCustomFieldType } from "./entities/crm-custom-field.entity";

const integrationUrl = process.env.CRM_INTEGRATION_DATABASE_URL;
const cryptoConfig = {
  AUTH_PEPPER: "crm-scoring-integration-test-pepper-value-long-enough",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 13).toString("base64"),
};

test("CRM Lead scoring persists explainable scores and integrates with filtered, sorted lists", { skip: !integrationUrl && "Set CRM_INTEGRATION_DATABASE_URL to run against PostgreSQL" }, async () => {
  const dataSource = new DataSource({ type: "postgres", url: integrationUrl!, synchronize: false, migrationsRun: false });
  const leadIds: string[] = [];
  const ruleIds: string[] = [];
  const viewIds: string[] = [];
  const segmentIds: string[] = [];
  const activityIds: string[] = [];
  const customFieldIds: string[] = [];
  const tagIds: string[] = [];
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
    assert.ok(actors[0], "CRM scoring integration test requires an active CRM manager");
    actorId = actors[0].id;
    const filters = new CrmFilterService(dataSource);
    const scoring = new CrmScoringService(dataSource, filters);
    const metadata = new CrmMetadataService(dataSource, scoring);
    const views = new CrmSavedViewService(dataSource, filters);
    const segments = new CrmSegmentService(dataSource, filters);
    const crypto = new AuthCryptoService(new ConfigService(cryptoConfig));
    const leads = new CrmLeadService(dataSource, crypto, filters, scoring);
    const marker = `crm-score-${randomUUID()}`;
    const lead = await leads.create({
      businessName: marker, contactName: "Test Contact", phone: "09121234567", email: `${marker}@example.com`,
      city: "Tehran", source: CrmLeadSource.Referral, priority: CrmLeadPriority.High,
    }, actorId);
    leadIds.push(lead.id);
    const unconfigured = await scoring.getScore(lead.id);
    assert.equal(unconfigured.configured, false);
    assert.equal(unconfigured.overall, 0);
    await assert.rejects(scoring.createRule({
      name: `${marker} recursive`, category: CrmScoringCategory.Fit, criteria: { version: 1, logic: "AND", conditions: [{ field: "overallScore", operator: "gte", value: 80 }] }, points: 5,
    }, actorId), { status: 400 });

    const customKey = `branch_count_${randomUUID().replaceAll("-", "")}`;
    const customField = await metadata.createField({ entityType: CrmCustomFieldEntityType.Lead, key: customKey, label: "Branch count", dataType: CrmCustomFieldType.Number }, actorId) as unknown as { id: string };
    customFieldIds.push(customField.id);
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Lead, lead.id, { [customKey]: 3 }, actorId);

    const selectKey = `business_kind_${randomUUID().replaceAll("-", "")}`;
    const selectField = await metadata.createField({ entityType: CrmCustomFieldEntityType.Lead, key: selectKey, label: "Business kind", dataType: CrmCustomFieldType.SingleSelect, options: [{ label: "Multi branch" }] }, actorId) as unknown as { id: string; options: { id: string }[] };
    customFieldIds.push(selectField.id);
    const optionId = selectField.options[0]!.id;
    await metadata.updateRecordFields(CrmCustomFieldEntityType.Lead, lead.id, { [selectKey]: optionId }, actorId);

    const fitRule = await scoring.createRule({
      name: `${marker} referral`, category: CrmScoringCategory.Fit, criteria: { version: 1, logic: "AND", conditions: [{ field: "source", operator: "is", value: "REFERRAL" }] }, points: 80,
    }, actorId);
    ruleIds.push(fitRule.id);
    const engagementRule = await scoring.createRule({
      name: `${marker} demo`, category: CrmScoringCategory.Engagement, criteria: { version: 1, logic: "AND", conditions: [{ field: "hasDemoActivity", operator: "isTrue" }] }, points: 40,
    }, actorId);
    ruleIds.push(engagementRule.id);
    const customRule = await scoring.createRule({
      name: `${marker} branches`, category: CrmScoringCategory.Fit, criteria: { version: 1, logic: "AND", conditions: [{ field: `custom:${customKey}`, operator: "gte", value: 3 }] }, points: 10, sortOrder: 10,
    }, actorId);
    ruleIds.push(customRule.id);
    const selectRule = await scoring.createRule({
      name: `${marker} business kind`, category: CrmScoringCategory.Fit, criteria: { version: 1, logic: "AND", conditions: [{ field: `custom:${selectKey}`, operator: "is", value: optionId }] }, points: 5, sortOrder: 20,
    }, actorId);
    ruleIds.push(selectRule.id);
    const activityCountRule = await scoring.createRule({
      name: `${marker} interactions`, category: CrmScoringCategory.Engagement, criteria: { version: 1, logic: "AND", conditions: [{ field: "activityCount", operator: "gte", value: 3 }] }, points: 15, sortOrder: 10,
    }, actorId);
    ruleIds.push(activityCountRule.id);
    const activityRows = await dataSource.query<Array<{ id: string }>>(`
      INSERT INTO crm_activities(lead_id,activity_type,subject,occurred_at,outcome)
      VALUES($1,'DEMO','Completed demo',now(),'COMPLETED') RETURNING id
    `, [lead.id]);
    activityIds.push(activityRows[0]!.id);
    await scoring.recalculateLead(lead.id, "ACTIVITY_CHANGED");

    const score = await scoring.getScore(lead.id);
    assert.equal(score.fit, 95);
    assert.equal(score.engagement, 40);
    assert.equal(score.overall, 68);
    assert.equal(score.configured, true);
    assert.equal(score.breakdown.fit.contributions[0].ruleId, fitRule.id);
    assert.equal(score.breakdown.fit.contributions[1].ruleId, customRule.id);
    assert.equal(score.breakdown.fit.contributions[2].ruleId, selectRule.id);
    assert.equal(score.breakdown.engagement.contributions[0].ruleId, engagementRule.id);
    assert.equal((await leads.get(lead.id) as unknown as { priority: string }).priority, CrmLeadPriority.High);

    const historyBefore = score.history.length;
    const addActivityAndRecalculate = () => dataSource.transaction(async (manager) => {
      const rows = await manager.query<Array<{ id: string }>>(`
        INSERT INTO crm_activities(lead_id,activity_type,subject,occurred_at)
        VALUES($1,'OTHER','Concurrent interaction',now()) RETURNING id
      `, [lead.id]);
      activityIds.push(rows[0]!.id);
      await scoring.recalculateLead(lead.id, "ACTIVITY_CHANGED", manager);
    });
    await Promise.all([addActivityAndRecalculate(), addActivityAndRecalculate()]);
    const concurrent = await scoring.getScore(lead.id);
    assert.equal(concurrent.engagement, 55, "overlapping Activity writes serialize score refreshes for their Lead");
    assert.equal(concurrent.overall, 75);
    await scoring.recalculateLead(lead.id, "MANUAL_RECALCULATION");
    assert.equal((await scoring.getScore(lead.id)).history.length, concurrent.history.length, "unchanged recalculation does not add history");

    const filtered = await leads.list({
      page: 1, pageSize: 20, archiveStatus: "ACTIVE", sort: "overallScore", direction: "DESC", q: marker,
      filter: JSON.stringify({ version: 1, logic: "AND", conditions: [{ field: "overallScore", operator: "gte", value: 75 }] }),
    });
    assert.equal(filtered.items[0]?.id, lead.id);

    const criteria = { version: 1, logic: "AND", conditions: [{ field: "overallScore", operator: "gte", value: 75 }] };
    const view = await views.create({ name: marker, entityType: CrmCustomFieldEntityType.Lead, visibility: "PRIVATE", filterDefinition: criteria, queryDefinition: { q: marker }, sortDefinition: { field: "overallScore", direction: "DESC" } }, actorId) as unknown as { id: string; criteriaValid: boolean };
    viewIds.push(view.id);
    assert.equal(view.criteriaValid, true);
    const segment = await segments.create({ name: marker, entityType: CrmCustomFieldEntityType.Lead, filterDefinition: criteria }, actorId) as unknown as { id: string } | undefined;
    if (!segment) throw new Error("Scoring integration Segment was not created");
    segmentIds.push(segment.id);
    assert.equal((await segments.preview(segment.id)).count, 1);

    await scoring.updateRule(engagementRule.id, { points: 60 }, actorId);
    const updated = await scoring.getScore(lead.id);
    assert.equal(updated.engagement, 75);
    assert.equal(updated.overall, 85);
    assert.ok(updated.history.length > concurrent.history.length);

    await metadata.archiveField(customField.id, actorId);
    const listedRules = await scoring.listRules() as unknown as Array<{ id: string; criteriaValid: boolean }>;
    const invalidRule = listedRules.find((item) => item.id === customRule.id);
    assert.equal(invalidRule?.criteriaValid, false, "archived-field rules stay visible with a warning and stop applying");
    const afterFieldArchive = await scoring.getScore(lead.id);
    assert.equal(afterFieldArchive.fit, 85);
    assert.equal(afterFieldArchive.engagement, 75);
    assert.equal(afterFieldArchive.overall, 80);

    await metadata.updateField(selectField.id, { options: [{ id: optionId, label: "Multi branch", active: false }] }, actorId);
    const afterOptionArchiveRules = await scoring.listRules() as unknown as Array<{ id: string; criteriaValid: boolean }>;
    assert.equal(afterOptionArchiveRules.find((item) => item.id === selectRule.id)?.criteriaValid, false, "archived select-option rules stay visible with a warning and stop applying");
    const afterOptionArchive = await scoring.getScore(lead.id);
    assert.equal(afterOptionArchive.fit, 80);
    assert.equal(afterOptionArchive.engagement, 75);
    assert.equal(afterOptionArchive.overall, 78);

    const tag = await metadata.createTag({ name: `${marker} multi branch` }, actorId) as unknown as { id: string };
    tagIds.push(tag.id);
    const tagRule = await scoring.createRule({
      name: `${marker} tag`, category: CrmScoringCategory.Fit,
      criteria: { version: 1, logic: "AND", conditions: [{ field: "tags", operator: "containsAny", value: [tag.id] }] }, points: 10,
    }, actorId);
    ruleIds.push(tagRule.id);
    await metadata.setRecordTags(CrmCustomFieldEntityType.Lead, lead.id, [tag.id], actorId);
    assert.equal((await scoring.getScore(lead.id)).fit, 90, "assigning a Tag recalculates its matching Lead");

    await scoring.updateRule(tagRule.id, { enabled: false }, actorId);
    assert.equal((await scoring.getScore(lead.id)).fit, 80, "disabling a matching rule removes its contribution");
    await scoring.updateRule(tagRule.id, { enabled: true }, actorId);
    assert.equal((await scoring.getScore(lead.id)).fit, 90, "enabling a matching rule restores its contribution");
    await metadata.setRecordTags(CrmCustomFieldEntityType.Lead, lead.id, [], actorId);
    assert.equal((await scoring.getScore(lead.id)).fit, 80, "removing a Tag recalculates its former Lead");

    await metadata.setRecordTags(CrmCustomFieldEntityType.Lead, lead.id, [tag.id], actorId);
    await metadata.archiveTag(tag.id, actorId);
    const afterTagArchiveRules = await scoring.listRules() as unknown as Array<{ id: string; criteriaValid: boolean }>;
    assert.equal(afterTagArchiveRules.find((item) => item.id === tagRule.id)?.criteriaValid, false, "archived Tag rules stay visible with a warning and stop applying");
    assert.equal((await scoring.getScore(lead.id)).fit, 80);
    await scoring.archiveRule(tagRule.id, actorId);
  } finally {
    if (dataSource.isInitialized) {
      const auditTargets = [...leadIds, ...ruleIds, ...viewIds, ...segmentIds, ...customFieldIds, ...tagIds, ...activityIds];
      if (auditTargets.length) await dataSource.query("DELETE FROM platform_audit_events WHERE target_id=ANY($1::text[])", [auditTargets]);
      if (viewIds.length) await dataSource.query("DELETE FROM crm_saved_views WHERE id=ANY($1::uuid[])", [viewIds]);
      if (segmentIds.length) await dataSource.query("DELETE FROM crm_segments WHERE id=ANY($1::uuid[])", [segmentIds]);
      if (activityIds.length) await dataSource.query("DELETE FROM crm_activities WHERE id=ANY($1::uuid[])", [activityIds]);
      if (tagIds.length) await dataSource.query("DELETE FROM crm_entity_tags WHERE tag_id=ANY($1::uuid[])", [tagIds]);
      if (leadIds.length) {
        await dataSource.query("DELETE FROM crm_lead_score_history WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_lead_scores WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_lead_status_history WHERE lead_id=ANY($1::uuid[])", [leadIds]);
        await dataSource.query("DELETE FROM crm_leads WHERE id=ANY($1::uuid[])", [leadIds]);
      }
      if (ruleIds.length) await dataSource.query("DELETE FROM crm_scoring_rules WHERE id=ANY($1::uuid[])", [ruleIds]);
      if (tagIds.length) await dataSource.query("DELETE FROM crm_tags WHERE id=ANY($1::uuid[])", [tagIds]);
      if (customFieldIds.length) {
        await dataSource.query("DELETE FROM crm_custom_field_options WHERE field_definition_id=ANY($1::uuid[])", [customFieldIds]);
        await dataSource.query("DELETE FROM crm_custom_field_definitions WHERE id=ANY($1::uuid[])", [customFieldIds]);
      }
      await dataSource.destroy();
    }
  }
});
