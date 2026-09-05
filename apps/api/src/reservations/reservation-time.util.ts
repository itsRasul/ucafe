export function timeToMinutes(value: string): number {
  const [hours = 0, minutes = 0] = value.slice(0, 5).split(":").map(Number);
  return hours * 60 + minutes;
}

export function minutesToTime(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

export function generateReservationSlots(opensAt: string, closesAt: string, intervalMinutes: number, durationMinutes: number) {
  const slots: Array<{ startTime: string; endTime: string }> = [];
  const close = timeToMinutes(closesAt);
  for (let start = timeToMinutes(opensAt); start + durationMinutes <= close; start += intervalMinutes) {
    slots.push({ startTime: minutesToTime(start), endTime: minutesToTime(start + durationMinutes) });
  }
  return slots;
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function localDateTimeParts(timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)!.value);
  const year = get("year"), month = get("month"), day = get("day");
  return { date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`, minutes: get("hour") * 60 + get("minute") };
}
