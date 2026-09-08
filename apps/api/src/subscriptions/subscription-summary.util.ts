const DAY_MS = 24 * 60 * 60 * 1000;

export function renewalWindow(periodEnd: Date | null, now = new Date()) {
  const daysUntilPeriodEnd = periodEnd ? Math.ceil((periodEnd.getTime() - now.getTime()) / DAY_MS) : null;
  return {
    daysUntilPeriodEnd,
    isRenewalWarning: daysUntilPeriodEnd != null && daysUntilPeriodEnd >= 0 && daysUntilPeriodEnd <= 3,
  };
}
