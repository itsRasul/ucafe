import { SubscriptionStatus } from "./entities";

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

export function addUtcMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function prorateToman(amountToman: string, usedMilliseconds: number, totalMilliseconds: number): bigint {
  if (usedMilliseconds <= 0 || totalMilliseconds <= 0) return 0n;
  const numerator = BigInt(amountToman) * BigInt(usedMilliseconds);
  const denominator = BigInt(totalMilliseconds);
  return (numerator + denominator / 2n) / denominator;
}

export interface LifecycleDates {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  paidThroughAt?: Date | null;
  graceEndsAt: Date | null;
}

export function effectiveSubscriptionStatus(subscription: LifecycleDates, now: Date, graceDays: number): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  if (subscription.status === SubscriptionStatus.Canceled) return { status: SubscriptionStatus.Canceled, graceEndsAt: subscription.graceEndsAt };
  const paidThroughAt = subscription.paidThroughAt ?? subscription.currentPeriodEndsAt;
  const entitlementEnd = paidThroughAt ?? subscription.trialEndsAt;
  if (!entitlementEnd || now < entitlementEnd) return { status: paidThroughAt ? SubscriptionStatus.Active : SubscriptionStatus.Trialing, graceEndsAt: null };
  if (!paidThroughAt) return { status: SubscriptionStatus.Suspended, graceEndsAt: null };
  const graceEndsAt = subscription.graceEndsAt ?? addDays(entitlementEnd, graceDays);
  if (now < graceEndsAt) return { status: SubscriptionStatus.Grace, graceEndsAt };
  return { status: SubscriptionStatus.Suspended, graceEndsAt };
}
