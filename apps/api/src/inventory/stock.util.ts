import { InventoryStockStatus } from "./entities";

const scale = 1_000_000n;
function micros(value: string) {
  const match = /^(-?)(\d{1,14})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new Error("Invalid normalized inventory quantity");
  const amount = BigInt(match[2]!) * scale + BigInt((match[3] ?? "").padEnd(6, "0") || "0");
  return match[1] ? -amount : amount;
}

export function compareQuantities(a: string, b: string) {
  const left = micros(a), right = micros(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export function inventoryStockStatus(quantity: string, minimum: string | null, par: string | null): InventoryStockStatus {
  if (compareQuantities(quantity, "0") < 0) return InventoryStockStatus.Negative;
  if (compareQuantities(quantity, "0") === 0) return InventoryStockStatus.OutOfStock;
  if (minimum !== null && compareQuantities(quantity, minimum) <= 0) return InventoryStockStatus.LowStock;
  if (par !== null && compareQuantities(quantity, par) < 0) return InventoryStockStatus.BelowPar;
  return InventoryStockStatus.Ok;
}
