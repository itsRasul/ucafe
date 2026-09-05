import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import type { DataSource } from "typeorm";
import type { PlatformAuditService } from "../audit/platform-audit.service";
import { AuthorizationScope, UserStatus } from "./entities";
import { PlatformAccessService } from "./platform-access.service";

const roleId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const actorUserId = "33333333-3333-4333-8333-333333333333";

function serviceWith(query: (sql: string, parameters?: unknown[]) => Promise<unknown>) {
  const audits: unknown[] = [];
  const manager = { query };
  const dataSource = {
    query,
    transaction: async <T>(work: (value: typeof manager) => Promise<T>) => work(manager),
  } as unknown as DataSource;
  const audit = { record: async (value: unknown) => { audits.push(value); } } as PlatformAuditService;
  return { service: new PlatformAccessService(dataSource, audit), audits };
}

test("platform user projections expose the complete phone to authorized callers", async () => {
  const { service } = serviceWith(async (sql) => sql.includes("count(*)::text") ? [{ total: "1" }] : [{ id: userId, phone: "+989121234567" }]);
  const result = await service.listUsers({ page: 1, pageSize: 20 });
  assert.equal(result.items[0]?.phone, "+989121234567");
});

test("creates a user and assigns the selected platform role atomically", async () => {
  const calls: Array<{ sql: string; parameters?: unknown[] }> = [];
  const { service, audits } = serviceWith(async (sql, parameters) => {
    calls.push({ sql, parameters });
    if (sql.includes("FROM roles")) return [{ id: roleId, key: "support_operator", name: "پشتیبان", scope: AuthorizationScope.Platform, coffeeShopId: null }];
    if (sql.includes("INSERT INTO users")) return [{ id: userId, phone: "+989121234567", status: UserStatus.Active, createdAt: new Date("2026-09-04T00:00:00Z") }];
    return [];
  });
  const result = await service.createUser({ phone: "۰۹۱۲۱۲۳۴۵۶۷", roleId }, actorUserId);
  assert.equal(result.phone, "+989121234567");
  assert.ok(calls.some(({ sql, parameters }) => sql.includes("INSERT INTO user_platform_roles") && parameters?.[0] === userId && parameters?.[1] === roleId));
  assert.equal(JSON.stringify(audits).includes("+989121234567"), false);
});

test("updates permissions on protected roles without renaming them", async () => {
  const updates: unknown[][] = [];
  const { service } = serviceWith(async (sql, parameters) => {
    if (sql.includes("FROM roles") && sql.includes("FOR UPDATE")) return [{ id: roleId, scope: AuthorizationScope.Platform, name: "مالک پلتفرم", isSystem: true, isProtected: true }];
    if (sql.includes("FROM permissions")) return [{ id: roleId }];
    if (sql.includes("HAVING count(DISTINCT p.key) = 2")) return [{ total: "1" }];
    if (sql.startsWith("UPDATE roles")) updates.push(parameters ?? []);
    return [];
  });
  await service.updateRole(roleId, { name: "نام غیرمجاز", permissionIds: [roleId] }, actorUserId);
  assert.deepEqual(updates[0], [roleId, "مالک پلتفرم"]);
});
