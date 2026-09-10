"use client";

import { useState } from "react";
import { useResolvedCart } from "../cart-store";
import { formatToman, type PublicMenu, type PublicOrderingState } from "../tenant-public";

export function CartPageClient({ menu, ordering }: { menu: PublicMenu; ordering: PublicOrderingState | null }) {
  const cart = useResolvedCart(menu);
  const [modal, setModal] = useState("");
  const disabledMessage = ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد.";

  return <section className="cart-page-shell" aria-labelledby="cart-title">
    <header className="cart-heading">
      <div><h1 id="cart-title">سبد خرید</h1><p>تعداد و انتخاب‌ها را پیش از تسویه بررسی کنید.</p></div>
      {cart.lines.length > 0 && <button className="text-button" type="button" onClick={cart.clear}>خالی کردن سبد</button>}
    </header>

    {!cart.lines.length ? <div className="cart-empty"><h2>سبد خرید خالی است</h2><p>از منو آیتم‌های موجود را به سبد اضافه کنید.</p><a href="/menu">رفتن به منو</a></div> : <div className="cart-layout">
      <div className="cart-lines">
        {cart.resolved.map((line) => <article className={`cart-line${line.available ? "" : " invalid"}`} key={`${line.menuItemId}:${line.variantId ?? ""}`}>
          <div>
            <h2>{line.item?.name ?? "آیتم حذف‌شده"}</h2>
            <p>{line.variant?.name ?? (line.item?.variants.length ? "اندازه نامعتبر" : "قیمت پایه")}</p>
            {line.reason && <strong>{line.reason}</strong>}
          </div>
          <div className="cart-quantity">
            <button type="button" onClick={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity - 1)} disabled={line.quantity <= 1}>−</button>
            <span>{new Intl.NumberFormat("fa-IR").format(line.quantity)}</span>
            <button type="button" onClick={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity + 1)} disabled={line.quantity >= 20}>+</button>
          </div>
          <div className="cart-line-price">
            <span>{line.unitPriceToman ? formatToman(line.unitPriceToman) : "نامشخص"}</span>
            <strong>{line.unitPriceToman ? formatToman(String(Number(line.unitPriceToman) * line.quantity)) : "—"}</strong>
          </div>
          <button className="cart-remove" type="button" onClick={() => cart.remove(line.menuItemId, line.variantId)}>حذف</button>
        </article>)}
      </div>
      <aside className="cart-summary">
        <h2>جمع سفارش</h2>
        <dl><div><dt>تعداد آیتم</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div><dt>مبلغ کل</dt><dd>{formatToman(String(cart.totalToman))}</dd></div></dl>
        {!cart.canCheckout && <p className="form-message error">برخی آیتم‌ها دیگر قابل سفارش نیستند.</p>}
        {ordering?.onlineOrderingAvailable ? cart.canCheckout ? <a className="cart-checkout" href="/checkout">ادامه به تسویه</a> : <button className="cart-checkout" type="button" disabled>ادامه به تسویه</button> : <button className="cart-checkout" type="button" onClick={() => setModal(disabledMessage)}>ادامه به تسویه</button>}
      </aside>
    </div>}

    {modal && <div className="tenant-modal-backdrop" role="presentation" onMouseDown={() => setModal("")}><section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="cart-disabled-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="cart-disabled-title">سفارش آنلاین فعال نیست</h2><p>{modal}</p><button type="button" onClick={() => setModal("")}>متوجه شدم</button></section></div>}
  </section>;
}
