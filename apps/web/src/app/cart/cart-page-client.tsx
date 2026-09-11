"use client";

import { useState } from "react";
import { useResolvedCart } from "../cart-store";
import { CartIcon, CartQuantityControl, TrashIcon } from "../cart-controls";
import { Picture, formatToman, type PublicMenu, type PublicOrderingState } from "../tenant-public";

export function CartPageClient({ menu, ordering }: { menu: PublicMenu; ordering: PublicOrderingState | null }) {
  const cart = useResolvedCart(menu);
  const [modal, setModal] = useState("");
  const disabledMessage = ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد.";

  return <section className="cart-page-shell" aria-labelledby="cart-title">
    <header className="cart-overview">
      <div className="cart-overview-copy"><h1 id="cart-title">سفارش شما آماده بررسی است</h1><p>محصولات انتخاب‌شده، تعداد و مبلغ سفارش را مرور کنید و سپس به مرحله تسویه بروید.</p></div>
      <dl className="cart-overview-stats"><div><dt>تعداد آیتم‌ها</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div><dt>مبلغ سفارش</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl>
    </header>

    {!cart.lines.length ? <div className="cart-empty"><CartIcon className="cart-empty-icon" /><h2>سبد خرید خالی است</h2><p>از منو نوشیدنی یا خوراکی دلخواهتان را انتخاب کنید.</p><a href="/menu">مشاهده منو</a></div> : <>
      <div className="cart-section-heading"><div><h2>محصولات انتخاب‌شده</h2><p>تعداد هر محصول را تغییر دهید یا آن را از سبد حذف کنید.</p></div><button className="cart-clear" type="button" onClick={cart.clear}><TrashIcon />حذف همه</button></div>
      <div className="cart-layout">
        <div className="cart-lines">
          {cart.resolved.map((line) => <article className={`cart-line${line.available ? "" : " invalid"}`} key={`${line.menuItemId}:${line.variantId ?? ""}`}>
            <Picture asset={line.item?.image} fallback="menu" alt={line.item?.image ? line.item.name : "تصویر جایگزین محصول"} className="cart-line-image" />
            <div className="cart-line-copy">
              <h2>{line.item?.name ?? "آیتم حذف‌شده"}</h2>
              <p>{line.variant?.name ?? (line.item?.variants.length ? "اندازه نامعتبر" : "قیمت پایه")}</p>
              {line.reason && <strong>{line.reason}</strong>}
            </div>
            <div className="cart-line-price">
              <span><small>قیمت واحد</small><b>{line.unitPriceToman ? formatToman(line.unitPriceToman) : "نامشخص"}</b></span>
              <span><small>قیمت نهایی</small><b>{line.unitPriceToman ? formatToman(String(Number(line.unitPriceToman) * line.quantity)) : "—"}</b></span>
            </div>
            <CartQuantityControl quantity={line.quantity} itemName={line.item?.name ?? "محصول"} onIncrease={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity + 1)} onDecrease={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity - 1)} onRemove={() => cart.remove(line.menuItemId, line.variantId)} />
          </article>)}
        </div>
        <aside className="cart-summary">
          <div><h2>خلاصه سفارش</h2><p>مرور نهایی پیش از ثبت سفارش</p></div>
          <dl><div><dt>تعداد محصولات</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div><dt>مجموع سفارش</dt><dd>{formatToman(String(cart.totalToman))}</dd></div><div className="cart-summary-total"><dt>مبلغ نهایی</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl>
          {!cart.canCheckout && <p className="form-message error">برخی آیتم‌ها دیگر قابل سفارش نیستند.</p>}
          {ordering?.onlineOrderingAvailable ? cart.canCheckout ? <a className="cart-checkout" href="/checkout">ادامه به تسویه</a> : <button className="cart-checkout" type="button" disabled>ادامه به تسویه</button> : <button className="cart-checkout" type="button" onClick={() => setModal(disabledMessage)}>ادامه به تسویه</button>}
        </aside>
      </div></>}

    {modal && <div className="tenant-modal-backdrop" role="presentation" onMouseDown={() => setModal("")}><section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="cart-disabled-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="cart-disabled-title">سفارش آنلاین فعال نیست</h2><p>{modal}</p><button type="button" onClick={() => setModal("")}>متوجه شدم</button></section></div>}
  </section>;
}
