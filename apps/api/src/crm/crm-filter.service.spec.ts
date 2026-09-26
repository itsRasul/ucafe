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
