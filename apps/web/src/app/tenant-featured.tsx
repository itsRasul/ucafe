"use client";

import { useState } from "react";
import { addCartItem, useCartLines } from "./cart-store";
import { CartQuantityControl } from "./cart-controls";
import { showAddedToCartToast, TenantToastContainer } from "./tenant-toast";
import { Picture, Price, type PublicMenuItem, type PublicOrderingState } from "./tenant-public";

export type FeaturedItem = PublicMenuItem & { categoryName: string };

export function TenantFeatured({ items, ordering }: { items: FeaturedItem[]; ordering: PublicOrderingState | null }) {
  const cart = useCartLines();
  const [orderingModal, setOrderingModal] = useState("");

  function addItem(item: PublicMenuItem) {
    if (!ordering?.onlineOrderingAvailable) {
      setOrderingModal(ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد.");
      return;
    }
    if (!item.isAvailable) return;
    addCartItem(item.id, null, 1);
    showAddedToCartToast(item.name, `${item.id}:base`);
  }

  return <>
    <div className="public-menu-grid featured-menu-grid">
      {items.map((item) => {
        const detailHref = `/menu?item=${encodeURIComponent(item.id)}`;
        const quantity = item.variants.length ? 0 : cart.lines.find((line) => line.menuItemId === item.id && line.variantId === null)?.quantity ?? 0;
        return <article className={`public-menu-card${item.isAvailable ? "" : " is-unavailable"}`} key={item.id}>
          <a className="public-menu-card-main" href={detailHref} aria-label={`مشاهده جزئیات ${item.name}`}>
            <Picture asset={item.image} fallback="menu" alt={item.image ? item.name : `تصویر جایگزین برای ${item.name}`} className="public-menu-card-image" />
            <span className="public-menu-card-copy">
              <span className="public-menu-card-heading"><strong>{item.name}</strong>{item.isFeatured && <small>پیشنهاد ما</small>}</span>
              {item.description && <span className="public-menu-card-description">{item.description}</span>}
              {!item.isAvailable && <span className="public-menu-unavailable">ناموجود</span>}
              <span className="public-menu-card-price"><Price item={item} /></span>
            </span>
          </a>
          {quantity > 0
            ? <CartQuantityControl className="public-menu-quantity" quantity={quantity} itemName={item.name} onIncrease={() => cart.setQuantity(item.id, null, quantity + 1)} onDecrease={() => cart.setQuantity(item.id, null, quantity - 1)} onRemove={() => cart.remove(item.id, null)} />
            : <button className="public-menu-add" type="button" disabled={!item.isAvailable} onClick={() => item.variants.length ? (window.location.href = detailHref) : addItem(item)}>
              {!item.isAvailable ? "ناموجود" : item.variants.length ? "انتخاب" : "افزودن به سبد خرید"}
            </button>}
        </article>;
      })}
    </div>
    <TenantToastContainer />
    {orderingModal && <div className="tenant-modal-backdrop" role="presentation" onMouseDown={() => setOrderingModal("")}><section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="featured-ordering-disabled-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="featured-ordering-disabled-title">سفارش آنلاین فعال نیست</h2><p>{orderingModal}</p><button type="button" onClick={() => setOrderingModal("")}>متوجه شدم</button></section></div>}
  </>;
}