const DAY_MS = 24 * 60 * 60 * 1000;

export function renewalWindow(periodEnd: Date | null, now = new Date()) {
  const rawDays = periodEnd ? Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS) : null;
  const daysUntilPeriodEnd = rawDays == null ? null : Math.max(0, rawDays);
  return {
    daysUntilPeriodEnd,
    isRenewalWarning: rawDays != null && rawDays >= 0 && rawDays <= 3,
  };
}
