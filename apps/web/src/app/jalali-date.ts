const persianDate = new Intl.DateTimeFormat("fa-IR-u-ca-persian", { year: "numeric", month: "2-digit", day: "2-digit" });
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

export function toIsoDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatJalaliDate(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return isoDate;
  return persianDate.format(new Date(year, month - 1, day));
}

export function formatJalaliDateAscii(isoDate: string) {
  return normalizeDateDigits(formatJalaliDate(isoDate));
}

export function normalizeDateDigits(value: string) {
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const persian = persianDigits.indexOf(digit);
    return String(persian >= 0 ? persian : digit.charCodeAt(0) - 1632);
  });
}

export function jalaliToIsoDate(value: string) {
  const match = normalizeDateDigits(value).trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (!match) return "";
  const [, jy, jm, jd] = match.map(Number);
  if (!jy || !jm || !jd || jm > 12 || jd > 31) return "";
  const g = jalaliToGregorian(jy, jm, jd);
  return toIsoDate(new Date(g.gy, g.gm - 1, g.gd));
}

function jalaliToGregorian(jy: number, jm: number, jd: number) {
  jy += 1595;
  let days = -355668 + 365 * jy + Math.floor(jy / 33) * 8 + Math.floor(((jy % 33) + 3) / 4) + jd + (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * Math.floor(days / 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * Math.floor(--days / 36524);
    days %= 36524;
    if (days >= 365) days++;
  }
  gy += 4 * Math.floor(days / 1461);
  days %= 1461;
  if (days > 365) {
    gy += Math.floor((days - 1) / 365);
    days = (days - 1) % 365;
  }
  const gd = days + 1;
  const kab = gy % 4 === 0 && gy % 100 !== 0 || gy % 400 === 0;
  const sal = [0, 31, kab ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 1;
  let remaining = gd;
  while (gm <= 12 && remaining > (sal[gm] ?? 31)) remaining -= sal[gm++] ?? 31;
  return { gy, gm, gd: remaining };
}
