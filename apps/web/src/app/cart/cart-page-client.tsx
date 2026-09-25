"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useResolvedCart, useServerCartQuote } from "../cart-store";
import { CartIcon, CartQuantityControl, TrashIcon } from "../cart-controls";
import { ClientAuthPanel } from "../client-auth-panel";
import { useClientSession } from "../client-session";
import { Picture, formatToman, type PublicMenu, type PublicOrderingState } from "../tenant-public";

export function CartPageClient({ menu, ordering, cafeName, logoUrl }: { menu: PublicMenu; ordering: PublicOrderingState | null; cafeName: string; logoUrl?: string }) {
  const cart = useResolvedCart(menu);
  const session = useClientSession();
  const serverQuote = useServerCartQuote(cart.lines, undefined, session.client ? session.api : undefined);
  const quotedLines = (menuItemId: string, variantId: string | null) => serverQuote.quote?.items.filter((item) => item.menuItemId === menuItemId && item.variantId === variantId) ?? [];
  const displayedTotal = serverQuote.quote?.totalAmountToman ?? String(cart.totalToman);
  const router = useRouter();
  const searchParams = useSearchParams();
  const [disabledModal, setDisabledModal] = useState("");
  const [authModal, setAuthModal] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const disabledMessage = ordering?.unavailableMessage ?? "امکان ثبت سفارش آنلاین برای این کافه در حال حاضر وجود ندارد.";

  useEffect(() => { if (searchParams.get("auth") === "checkout" && session.state === "ready" && !session.client) setAuthModal(true); }, [searchParams, session.state, session.client]);
  useEffect(() => { if (authModal) requestAnimationFrame(() => dialog.current?.querySelector<HTMLElement>("input, button, a")?.focus()); }, [authModal]);

  function continueCheckout() {
    if (!ordering?.onlineOrderingAvailable) { setDisabledModal(disabledMessage); return; }
    if (session.state === "loading") return;
    if (session.client) router.push("/checkout"); else setAuthModal(true);
  }

  function trapFocus(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") { setAuthModal(false); return; }
    if (event.key !== "Tab") return;
    const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [])];
    if (!controls.length) return;
    const first = controls[0]; const last = controls.at(-1)!;
    if (!first) return;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  return <section className="cart-page-shell" aria-labelledby="cart-title">
    <header className="cart-overview">
      <div className="cart-overview-copy"><h1 id="cart-title">سفارش شما آماده بررسی است</h1><p>محصولات انتخاب‌شده، تعداد و مبلغ سفارش را مرور کنید و سپس به مرحله تسویه بروید.</p></div>
      <dl className="cart-overview-stats"><div><dt>تعداد آیتم‌ها</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div><dt>مبلغ سفارش</dt><dd>{formatToman(displayedTotal)}</dd></div></dl>
    </header>

    {!cart.lines.length ? <div className="cart-empty"><CartIcon className="cart-empty-icon" /><h2>سبد خرید خالی است</h2><p>از منو نوشیدنی یا خوراکی دلخواهتان را انتخاب کنید.</p><a href="/menu">مشاهده منو</a></div> : <>
      <div className="cart-section-heading"><div><h2>محصولات انتخاب‌شده</h2><p>تعداد هر محصول را تغییر دهید یا آن را از سبد حذف کنید.</p></div><button className="cart-clear" type="button" onClick={cart.clear}><TrashIcon />حذف همه</button></div>
      <div className="cart-layout">
        <div className="cart-lines">
          {cart.resolved.map((line) => {
            const quotes = quotedLines(line.menuItemId, line.variantId);
            const final = quotes.reduce((sum, item) => sum + BigInt(item.lineTotalToman), BigInt(0));
            const original = quotes.length ? BigInt(quotes[0]!.originalUnitPriceToman) * BigInt(line.quantity) : BigInt(0);
            const promotions = [...new Set(quotes.map((item) => item.ruleSummary ?? item.promotionName).filter((name): name is string => Boolean(name)))];
            return <article className={`cart-line${line.available ? "" : " invalid"}`} key={`${line.menuItemId}:${line.variantId ?? ""}`}>
            <Picture asset={line.item?.image} fallback="menu" alt={line.item?.image ? line.item.name : "تصویر جایگزین محصول"} className="cart-line-image" />
            <div className="cart-line-copy">
              <h2>{line.item?.name ?? "آیتم حذف‌شده"}</h2>
              <p>{line.variant?.name ?? (line.item?.variants.length ? "اندازه نامعتبر" : "قیمت پایه")}</p>
              {line.reason && <strong>{line.reason}</strong>}
            </div>
            <div className="cart-line-price">
              <span><small>{quotes.length > 1 ? "جزئیات قیمت" : "قیمت واحد"}</small><b>{quotes.length === 1 ? <>{quotes[0]!.discountAmountToman !== "0" && <del>{formatToman(quotes[0]!.originalUnitPriceToman)}</del>} {formatToman(quotes[0]!.unitPriceToman)}</> : line.unitPriceToman ? formatToman(line.unitPriceToman) : "نامشخص"}</b>{quotes.length > 1 && <small>{quotes.map((quote, index) => <span key={`${quote.unitPriceToman}:${index}`}>{quote.quantity} × {quote.allocationType === "GET" && quote.unitPriceToman === "0" ? "رایگان" : formatToman(quote.unitPriceToman)}{index < quotes.length - 1 ? " · " : ""}</span>)}</small>}{promotions.map((name) => <small key={name}>{name}</small>)}</span>
              <span><small>قیمت نهایی</small><b>{quotes.length ? formatToman(final.toString()) : line.unitPriceToman ? formatToman((BigInt(line.unitPriceToman) * BigInt(line.quantity)).toString()) : "—"}</b>{quotes.length > 1 && <small><del>{formatToman(original.toString())}</del></small>}</span>
            </div>
            <CartQuantityControl quantity={line.quantity} itemName={line.item?.name ?? "محصول"} onIncrease={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity + 1)} onDecrease={() => cart.setQuantity(line.menuItemId, line.variantId, line.quantity - 1)} onRemove={() => cart.remove(line.menuItemId, line.variantId)} />
            </article>;
          })}
        </div>
        <aside className="cart-summary">
          <div><h2>خلاصه سفارش</h2><p>قیمت نهایی با نرخ فعلی محاسبه می‌شود؛ تخفیف‌های زمان‌دار فقط در بازه خود فعال‌اند.</p></div>
          <dl><div><dt>تعداد محصولات</dt><dd>{new Intl.NumberFormat("fa-IR").format(cart.count)}</dd></div><div><dt>مجموع پیش از تخفیف</dt><dd>{formatToman(serverQuote.quote?.subtotalBeforeDiscountToman ?? String(cart.totalToman))}</dd></div>{serverQuote.quote && Number(serverQuote.quote.itemDiscountTotalToman) > 0 && <div><dt>تخفیف محصولات</dt><dd>−{formatToman(serverQuote.quote.itemDiscountTotalToman)}</dd></div>}{serverQuote.quote && Number(serverQuote.quote.orderDiscountToman) > 0 && <div><dt>{serverQuote.quote.couponCode ? `کد ${serverQuote.quote.couponCode}` : serverQuote.quote.orderPromotionName ?? "تخفیف سفارش"}</dt><dd>−{formatToman(serverQuote.quote.orderDiscountToman)}</dd></div>}<div className="cart-summary-total"><dt>مبلغ نهایی</dt><dd>{formatToman(displayedTotal)}</dd></div></dl>
          {cart.lines.length > 0 && serverQuote.loading && <p className="cart-quote-status" role="status">در حال به‌روزرسانی قیمت‌ها…</p>}
          {serverQuote.error && <p className="form-message error" role="alert">دریافت قیمت نهایی سبد ممکن نشد؛ دوباره تلاش کنید.</p>}
          {!cart.canCheckout && <p className="form-message error">برخی آیتم‌ها دیگر قابل سفارش نیستند.</p>}
          <button className="cart-checkout" type="button" disabled={!cart.canCheckout || !serverQuote.quote || serverQuote.loading || session.state === "loading"} onClick={continueCheckout}>{session.state === "loading" ? "در حال بررسی…" : serverQuote.loading ? "در حال به‌روزرسانی قیمت…" : "ادامه به تسویه"}</button>
        </aside>
      </div></>}

    {disabledModal && <div className="tenant-modal-backdrop" role="presentation" onMouseDown={() => setDisabledModal("")}><section className="tenant-modal" role="dialog" aria-modal="true" aria-labelledby="cart-disabled-title" onMouseDown={(event) => event.stopPropagation()}><h2 id="cart-disabled-title">سفارش آنلاین فعال نیست</h2><p>{disabledModal}</p><button type="button" onClick={() => setDisabledModal("")}>متوجه شدم</button></section></div>}
    {authModal && <div className="tenant-modal-backdrop checkout-auth-backdrop" role="presentation" onMouseDown={() => setAuthModal(false)}>
      <div className="checkout-auth-modal" role="dialog" aria-modal="true" aria-label="ورود یا ثبت‌نام برای تسویه" ref={dialog} onKeyDown={trapFocus} onMouseDown={(event) => event.stopPropagation()}>
        <button className="checkout-modal-close" type="button" aria-label="بستن فرم ورود" onClick={() => setAuthModal(false)}>×</button>
        <ClientAuthPanel session={session} cafeName={cafeName} logoUrl={logoUrl} showBackLink={false} onAuthenticated={() => router.push("/checkout")} />
      </div>
    </div>}
  </section>;
}
