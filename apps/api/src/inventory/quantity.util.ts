import { BadRequestException } from "@nestjs/common";
import { InventoryDimension } from "./entities";

const factors: Record<string, bigint> = { g: 1n, kg: 1000n, ml: 1n, l: 1000n };
const scale = 1_000_000n;
export function quantityToBase(value: string, dimension: InventoryDimension, unit: string, baseUnit: string): string {
  if (dimension === InventoryDimension.Weight && !["g", "kg"].includes(unit) || dimension === InventoryDimension.Volume && !["ml", "l"].includes(unit) || dimension === InventoryDimension.Count && unit !== baseUnit) throw new BadRequestException("Unit does not match this inventory item");
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new BadRequestException("Quantity must have at most six decimal places");
  const fraction = (match[3] ?? "").padEnd(6, "0");
  const micros = (BigInt(match[2]!) * scale + BigInt(fraction || "0")) * (match[1] ? -1n : 1n);
  const factor = factors[unit] ?? 1n;
  const baseFactor = factors[baseUnit] ?? 1n;
  if (micros * factor % baseFactor !== 0n) throw new BadRequestException("Converted quantity exceeds six decimal places");
  return format(micros * factor / baseFactor);
}

export function addQuantities(...values: string[]): string {
  const total = values.reduce((sum, value) => {
    const negative = value.startsWith("-");
    const [whole, decimal = ""] = (negative ? value.slice(1) : value).split(".");
    return sum + (BigInt(whole!) * scale + BigInt(decimal.padEnd(6, "0"))) * (negative ? -1n : 1n);
  }, 0n);
  return format(total);
}

function format(total: bigint) {
  const abs = total < 0 ? -total : total;
  const fraction = (abs % scale).toString().padStart(6, "0").replace(/0+$/, "");
  return `${total < 0 ? "-" : ""}${abs / scale}${fraction ? `.${fraction}` : ""}`;
}
