"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { PublicMenu, PublicMenuItem, PublicMenuVariant } from "./tenant-public";

export type CartLine = { menuItemId: string; variantId: string | null; quantity: number };
export type CartResolvedLine = CartLine & { item: PublicMenuItem | null; variant: PublicMenuVariant | null; unitPriceToman: string | null; available: boolean; reason: string | null };

const eventName = "ucafe-cart";

function key() {
  return `ucafe_cart:${location.host.toLowerCase()}`;
}

function sameLine(a: CartLine, b: Pick<CartLine, "menuItemId" | "variantId">) {
  return a.menuItemId === b.menuItemId && (a.variantId ?? null) === (b.variantId ?? null);
}

export function readCartLines(): CartLine[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(key()) ?? "[]") as CartLine[];
    return Array.isArray(parsed) ? parsed.filter((line) => line.menuItemId && Number.isInteger(line.quantity) && line.quantity > 0).map((line) => ({ menuItemId: line.menuItemId, variantId: line.variantId ?? null, quantity: Math.min(20, line.quantity) })) : [];
  } catch {
    return [];
  }
}

export function writeCartLines(lines: CartLine[]) {
  localStorage.setItem(key(), JSON.stringify(lines.filter((line) => line.quantity > 0)));
  window.dispatchEvent(new Event(eventName));
}

export function addCartItem(menuItemId: string, variantId: string | null, quantity = 1) {
  const lines = readCartLines();
  const existing = lines.find((line) => sameLine(line, { menuItemId, variantId }));
  if (existing) existing.quantity = Math.min(20, existing.quantity + quantity);
  else lines.push({ menuItemId, variantId, quantity: Math.min(20, quantity) });
  writeCartLines(lines);
}

export function clearCart() {
  writeCartLines([]);
}

export function useCartLines() {
  const [lines, setLines] = useState<CartLine[]>([]);
  useEffect(() => {
    const sync = () => setLines(readCartLines());
    sync();
    addEventListener(eventName, sync);
    addEventListener("storage", sync);
    return () => { removeEventListener(eventName, sync); removeEventListener("storage", sync); };
  }, []);
  const setQuantity = useCallback((menuItemId: string, variantId: string | null, quantity: number) => writeCartLines(readCartLines().map((line) => sameLine(line, { menuItemId, variantId }) ? { ...line, quantity } : line)), []);
  const remove = useCallback((menuItemId: string, variantId: string | null) => writeCartLines(readCartLines().filter((line) => !sameLine(line, { menuItemId, variantId }))), []);
  return { lines, count: lines.reduce((sum, line) => sum + line.quantity, 0), setQuantity, remove, clear: clearCart };
}

export function useResolvedCart(menu: PublicMenu) {
  const cart = useCartLines();
  const resolved = useMemo<CartResolvedLine[]>(() => {
    const items = new Map(menu.flatMap((category) => category.items.map((item) => [item.id, item] as const)));
    return cart.lines.map((line) => {
      const item = items.get(line.menuItemId) ?? null;
      const variant = line.variantId ? item?.variants.find((candidate) => candidate.id === line.variantId) ?? null : null;
      const variantsRequired = Boolean(item?.variants.length);
      const unitPriceToman = variant?.priceToman ?? (!variantsRequired ? item?.basePriceToman ?? null : null);
      const available = Boolean(item && item.isAvailable && (!variantsRequired || (variant && variant.isAvailable)) && unitPriceToman);
      const reason = !item ? "این آیتم از منو حذف شده است." : !item.isAvailable ? "این آیتم ناموجود است." : variantsRequired && !variant ? "اندازه انتخابی دیگر در دسترس نیست." : variant && !variant.isAvailable ? "این اندازه ناموجود است." : !unitPriceToman ? "قیمت این آیتم در دسترس نیست." : null;
      return { ...line, item, variant, unitPriceToman, available, reason };
    });
  }, [cart.lines, menu]);
  return { ...cart, resolved, totalToman: resolved.reduce((sum, line) => sum + (line.unitPriceToman ? Number(line.unitPriceToman) * line.quantity : 0), 0), canCheckout: resolved.length > 0 && resolved.every((line) => line.available) };
}
