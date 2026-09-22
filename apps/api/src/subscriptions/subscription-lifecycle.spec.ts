import assert from "node:assert/strict";
import test from "node:test";
import { SubscriptionStatus } from "./entities";
import { addUtcMonths, effectiveSubscriptionStatus, prorateToman } from "./subscription-lifecycle";

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

test("paid-through controls active and grace boundaries", () => {
  const paidThroughAt = new Date("2026-10-01T10:00:00.000Z");
  const result = effectiveSubscriptionStatus({ status: SubscriptionStatus.Active, trialEndsAt: null, currentPeriodEndsAt: new Date("2026-09-01T10:00:00.000Z"), paidThroughAt, graceEndsAt: null }, paidThroughAt, 7);
  assert.equal(result.status, SubscriptionStatus.Grace);
  assert.equal(result.graceEndsAt?.toISOString(), "2026-10-08T10:00:00.000Z");
});

test("proration uses duration and rounds half up to a whole toman", () => {
  assert.equal(prorateToman("910000", 20, 30), 606667n);
  assert.equal(prorateToman("1", 1, 2), 1n);
  assert.equal(prorateToman("100", 0, 30), 0n);
});
