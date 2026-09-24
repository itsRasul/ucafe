const faDigits = (value: string) => value
  .replace(/\B(?=(\d{3})+(?!\d))/g, "٬")
  .replace(/\./g, "٫")
  .replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[Number(digit)]!);

export const toman = (value: string | null) => {
  if (value === null) return "—";
  const negative = value.startsWith("-");
  const [whole = "0", fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const exact = fraction.replace(/0+$/, "");
  return `${negative ? "−" : ""}${faDigits(exact ? `${whole}.${exact}` : whole)} تومان`;
};

export const percent = (value: string | null) => value === null ? "—" : `${faDigits(value)}٪`;
