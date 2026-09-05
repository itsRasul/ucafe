const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

export function normalizeIranianMobile(value: string): string {
  const ascii = [...value.trim()].map((character) => {
    const persianIndex = PERSIAN_DIGITS.indexOf(character);
    if (persianIndex >= 0) return String(persianIndex);
    const arabicIndex = ARABIC_DIGITS.indexOf(character);
    return arabicIndex >= 0 ? String(arabicIndex) : character;
  }).join("");

  const compact = ascii.replace(/[\s()-]/g, "");
  let normalized = compact;
  if (normalized.startsWith("0098")) normalized = `+${normalized.slice(2)}`;
  else if (normalized.startsWith("98")) normalized = `+${normalized}`;
  else if (normalized.startsWith("09")) normalized = `+98${normalized.slice(1)}`;

  if (!/^\+989\d{9}$/.test(normalized)) throw new Error("Iranian mobile number is invalid");
  return normalized;
}

export function maskPhone(phone: string): string {
  return `${phone.slice(0, 4)}*****${phone.slice(-2)}`;
}
