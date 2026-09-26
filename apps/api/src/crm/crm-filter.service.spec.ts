import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CrmFilterService } from "./crm-filter.service";

const serviceWith = (query: (...args: any[]) => Promise<any>) => new CrmFilterService({ query } as unknown as DataSource);

test("compiles user filter values as SQL parameters", async () => {
  const calls: unknown[][] = [];
  const service = serviceWith(async (sql, values) => { calls.push([sql, values]); return []; });
  const values: unknown[] = [];
  const sql = await service.compile(CrmCustomFieldEntityType.Organization, {
    version: 1, logic: "AND", conditions: [{ field: "name", operator: "contains", value: "%' OR true --" }],
  }, values, { entity: "o" });

  assert.match(sql, /o\.name ILIKE \$1 ESCAPE '!'/);
  assert.equal(values.length, 1);
  assert.equal(values[0], "%!%' OR true --%");
  assert.equal(calls.length, 1);
});

test("rejects unknown fields and values from another select field", async () => {
  const service = serviceWith(async () => []);
  await assert.rejects(service.compile(CrmCustomFieldEntityType.Organization, {
    version: 1, logic: "AND", conditions: [{ field: "custom_sql", operator: "equals", value: "x" }],
  }, [], { entity: "o" }), BadRequestException);
  await assert.rejects(service.compile(CrmCustomFieldEntityType.Deal, {
    version: 1, logic: "AND", conditions: [{ field: "status", operator: "is", value: "QUALIFIED" }],
  }, [], { entity: "d" }), BadRequestException);
});

test("exposes parameterized activity and score fields for Lead filters", async () => {
  const service = serviceWith(async (sql, values) => {
    if (sql.includes("FROM crm_custom_field_definitions")) return [];
    if (sql.includes("FROM crm_tags")) return [];
    if (sql.includes("FROM crm_custom_field_options")) return [];
    return [];
  });
  const values: unknown[] = [];
  const sql = await service.compile(CrmCustomFieldEntityType.Lead, {
    version: 1, logic: "AND", conditions: [
      { field: "daysSinceLastActivity", operator: "lte", value: 7 },
      { field: "overallScore", operator: "gte", value: 80 },
      { field: "hasDemoActivity", operator: "isTrue" },
    ],
  }, values, { entity: "l", organization: "o", evaluationTime: "$2::timestamptz" });
  assert.match(sql, /max\(a\.occurred_at\)/);
  assert.match(sql, /crm_lead_scores/);
  assert.match(sql, /a\.activity_type='DEMO'/);
  assert.match(sql, /a\.outcome='COMPLETED'/);
  assert.deepEqual(values, [7, 80]);
});

test("allows score fields as Saved View and Segment sort keys", async () => {
  const service = serviceWith(async () => []);
  assert.deepEqual(await service.validateSort(CrmCustomFieldEntityType.Lead, { field: "overallScore", direction: "DESC" }), { field: "overallScore", direction: "DESC" });
});

test("rejects archived custom select options in saved criteria and scoring rules", async () => {
  const definitionId = "11111111-1111-4111-8111-111111111111";
  const service = serviceWith(async (sql) => {
    if (sql.includes("FROM crm_custom_field_definitions")) return [{ id: definitionId, key: "business_kind", data_type: "SINGLE_SELECT" }];
    if (sql.includes("FROM crm_custom_field_options")) return [];
    return [];
  });
  await assert.rejects(service.compile(CrmCustomFieldEntityType.Lead, {
    version: 1, logic: "AND", conditions: [{ field: "custom:business_kind", operator: "is", value: "22222222-2222-4222-8222-222222222222" }],
  }, [], { entity: "l" }), BadRequestException);
});
