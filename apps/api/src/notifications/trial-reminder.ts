import { NotificationType } from "./notification-type";

export const trialReminderTypes = [NotificationType.TrialExpires7Days, NotificationType.TrialExpires2Days, NotificationType.TrialExpired, NotificationType.TrialExpiredFollowUp];

/** Catch up only within a message's meaningful window; never emit a backlog. */
export function dueTrialReminder(endsAt: Date, now: Date): NotificationType | null {
  const remaining = (endsAt.getTime() - now.getTime()) / 86_400_000;
  if (remaining > 6 && remaining <= 7) return NotificationType.TrialExpires7Days;
  if (remaining > 1 && remaining <= 2) return NotificationType.TrialExpires2Days;
  if (remaining <= 0 && remaining > -3) return NotificationType.TrialExpired;
  if (remaining <= -3 && remaining > -7) return NotificationType.TrialExpiredFollowUp;
  return null;
}
