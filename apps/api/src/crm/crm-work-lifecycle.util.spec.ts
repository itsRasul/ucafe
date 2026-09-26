import assert from "node:assert/strict";
import test from "node:test";
import { CrmActivityType } from "./entities/crm-activity.entity";
import { CrmTaskStatus } from "./entities/crm-task.entity";
import { isCrmTaskOverdue, isValidCrmActivityOutcome } from "./crm-work-lifecycle.util";

test("activity outcomes match the selected interaction type", () => {
  assert.equal(isValidCrmActivityOutcome(CrmActivityType.Call, "CONNECTED"), true);
  assert.equal(isValidCrmActivityOutcome(CrmActivityType.Demo, "NO_SHOW"), true);
  assert.equal(isValidCrmActivityOutcome(CrmActivityType.Call, "NO_SHOW"), false);
  assert.equal(isValidCrmActivityOutcome(CrmActivityType.Email, "CONNECTED"), false);
  assert.equal(isValidCrmActivityOutcome(CrmActivityType.Email, null), true);
});

test("overdue is derived only for open tasks with a past due time", () => {
  const now = new Date("2026-09-26T12:00:00Z");
  assert.equal(isCrmTaskOverdue(CrmTaskStatus.Open, "2026-09-26T11:59:59Z", now), true);
  assert.equal(isCrmTaskOverdue(CrmTaskStatus.Open, "2026-09-26T12:00:00Z", now), false);
  assert.equal(isCrmTaskOverdue(CrmTaskStatus.Open, "2026-09-26T12:00:01Z", now), false);
  assert.equal(isCrmTaskOverdue(CrmTaskStatus.Completed, "2026-09-25T12:00:00Z", now), false);
  assert.equal(isCrmTaskOverdue(CrmTaskStatus.Open, null, now), false);
});
