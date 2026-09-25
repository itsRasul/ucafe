export const PROMOTION_WEEKDAYS = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"] as const;
export type PromotionWeekday = typeof PROMOTION_WEEKDAYS[number];

export type PromotionScheduleWindowLike = {
  daysOfWeek: readonly PromotionWeekday[];
  startTime: string | null;
  endTime: string | null;
  isAllDay: boolean;
};

const intlWeekday: Record<string, PromotionWeekday> = {
  Monday: "MONDAY", Tuesday: "TUESDAY", Wednesday: "WEDNESDAY", Thursday: "THURSDAY",
  Friday: "FRIDAY", Saturday: "SATURDAY", Sunday: "SUNDAY",
};

export function isValidTimeZone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function timeMilliseconds(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours! * 60 + minutes!) * 60_000;
}

export function promotionScheduleMatches(
  windows: readonly PromotionScheduleWindowLike[],
  timestamp: Date,
  timezone: string,
): boolean {
  if (!windows.length) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone, weekday: "long", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(timestamp);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = intlWeekday[value("weekday")];
  if (!weekday) return false;
  const currentDayIndex = PROMOTION_WEEKDAYS.indexOf(weekday);
  const previousWeekday = PROMOTION_WEEKDAYS[(currentDayIndex + 6) % 7]!;
  const localTime = Number(value("hour")) * 3_600_000 + Number(value("minute")) * 60_000 + Number(value("second")) * 1_000 + timestamp.getUTCMilliseconds();

  return windows.some((window) => {
    if (window.isAllDay) return window.daysOfWeek.includes(weekday);
    if (!window.startTime || !window.endTime) return false;
    const start = timeMilliseconds(window.startTime);
    const end = timeMilliseconds(window.endTime);
    if (start < end) return window.daysOfWeek.includes(weekday) && start <= localTime && localTime < end;
    return (window.daysOfWeek.includes(weekday) && localTime >= start)
      || (window.daysOfWeek.includes(previousWeekday) && localTime < end);
  });
}
