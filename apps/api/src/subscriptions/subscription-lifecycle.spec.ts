import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionStatus } from "./entities";
import { addUtcMonths, effectiveSubscriptionStatus } from "./subscription-lifecycle";

test("a trial suspends when it expires without payment", () => {
  const end = new Date("2026-09-02T10:00:00.000Z");
  const result = effectiveSubscriptionStatus({ status: SubscriptionStatus.Trialing, trialEndsAt: end, currentPeriodEndsAt: null, graceEndsAt: null }, end, 7);
  assert.equal(result.status, SubscriptionStatus.Suspended);
  assert.equal(result.graceEndsAt, null);
});

test("a paid subscription enters grace after its prepaid period", () => {
  const end = new Date("2026-09-26T10:00:00.000Z");
  const result = effectiveSubscriptionStatus({ status: SubscriptionStatus.Active, trialEndsAt: null, currentPeriodEndsAt: end, graceEndsAt: null }, end, 7);
  assert.equal(result.status, SubscriptionStatus.Grace);
  assert.equal(result.graceEndsAt?.toISOString(), "2026-10-03T10:00:00.000Z");
});

test("a subscription suspends when grace expires", () => {
  const end = new Date("2026-09-26T10:00:00.000Z");
  const graceEnd = new Date("2026-10-03T10:00:00.000Z");
  const result = effectiveSubscriptionStatus({ status: SubscriptionStatus.Grace, trialEndsAt: null, currentPeriodEndsAt: end, graceEndsAt: graceEnd }, graceEnd, 7);
  assert.equal(result.status, SubscriptionStatus.Suspended);
});

test("calendar-month billing clamps end-of-month dates", () => {
  assert.equal(addUtcMonths(new Date("2026-01-31T12:00:00.000Z"), 1).toISOString(), "2026-02-28T12:00:00.000Z");
});
