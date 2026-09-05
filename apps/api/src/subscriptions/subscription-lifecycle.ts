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

export interface LifecycleDates {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEndsAt: Date | null;
  graceEndsAt: Date | null;
}

export function effectiveSubscriptionStatus(subscription: LifecycleDates, now: Date, graceDays: number): { status: SubscriptionStatus; graceEndsAt: Date | null } {
  if (subscription.status === SubscriptionStatus.Canceled) return { status: SubscriptionStatus.Canceled, graceEndsAt: subscription.graceEndsAt };
  const entitlementEnd = subscription.currentPeriodEndsAt ?? subscription.trialEndsAt;
  if (!entitlementEnd || now < entitlementEnd) return { status: subscription.currentPeriodEndsAt ? SubscriptionStatus.Active : SubscriptionStatus.Trialing, graceEndsAt: null };
  if (!subscription.currentPeriodEndsAt) return { status: SubscriptionStatus.Suspended, graceEndsAt: null };
  const graceEndsAt = subscription.graceEndsAt ?? addDays(entitlementEnd, graceDays);
  if (now < graceEndsAt) return { status: SubscriptionStatus.Grace, graceEndsAt };
  return { status: SubscriptionStatus.Suspended, graceEndsAt };
}
