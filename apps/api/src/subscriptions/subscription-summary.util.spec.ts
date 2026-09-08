import assert from "node:assert/strict";
import test from "node:test";
import { renewalWindow } from "./subscription-summary.util";

const now = new Date("2026-09-08T08:00:00.000Z");

test("renewal warning starts three days before period end", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-11T08:00:00.000Z"), now), { daysUntilPeriodEnd: 3, isRenewalWarning: true });
});

test("renewal warning is quiet before the three-day window", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-12T08:00:00.000Z"), now), { daysUntilPeriodEnd: 4, isRenewalWarning: false });
});

test("renewal warning does not show after the entitlement end has passed", () => {
  assert.deepEqual(renewalWindow(new Date("2026-09-07T08:00:00.000Z"), now), { daysUntilPeriodEnd: -1, isRenewalWarning: false });
});
