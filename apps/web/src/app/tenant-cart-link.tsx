"use client";

import { useCartLines } from "./cart-store";
import { CartIcon } from "./cart-controls";

export function TenantCartLink() {
  const { count } = useCartLines();
  return <a className="tenant-cart-link tenant-nav-cta" href="/cart" aria-label={`سبد خرید، ${count} آیتم`}>
    <CartIcon className="tenant-cart-icon" />
    <span className="sr-only">سبد خرید</span>
    {count > 0 && <b>{new Intl.NumberFormat("fa-IR").format(count)}</b>}
  </a>;
}
