"use client";

import { useCartLines } from "./cart-store";

export function TenantCartLink() {
  const { count } = useCartLines();
  return <a className="tenant-cart-link" href="/cart" aria-label={`سبد خرید، ${count} آیتم`}>
    <span className="tenant-cart-icon" aria-hidden="true" />
    <span>سبد خرید</span>
    {count > 0 && <b>{new Intl.NumberFormat("fa-IR").format(count)}</b>}
  </a>;
}
