"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useClientSession } from "../../client-session";
import { formatToman } from "../../tenant-public";

type Order = { id: string; status: string; deliveryMethod: "PICKUP" | "COURIER"; paymentMethod: "OFFLINE"; totalAmountToman: string; customerNote: string | null; deliveryAddressSnapshot: { city: string | null; addressLine: string; buildingNumber: string | null; unit: string | null } | null };

const statusLabels: Record<string, string> = { UNDER_REVIEW: "در حال بررسی", ACCEPTED: "تأیید شد", PREPARING: "در حال آماده‌سازی", READY: "آماده دریافت", OUT_FOR_DELIVERY: "در مسیر ارسال", COMPLETED: "تکمیل شد", REJECTED: "رد شد", CANCELED: "لغو شد" };

export function CheckoutResultClient() {
  const session = useClientSession();
  const params = useSearchParams();
  const router = useRouter();
  const [order, setOrder] = useState<Order | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const id = params.get("order");
    if (session.state !== "ready") return;
    if (!session.client || !id) { router.replace("/cart"); return; }
    session.api<Order>(`/public/orders/${encodeURIComponent(id)}`).then(setOrder).catch(() => setError("نمایش نتیجه سفارش ممکن نشد."));
  }, [params, router, session.client, session.state, session.api]);

  if (session.state === "loading" || (!order && !error)) return <div className="checkout-route-loading" aria-live="polite"><span className="admin-spinner" />در حال دریافت نتیجه سفارش…</div>;
  if (error) return <section className="checkout-result-shell"><div className="checkout-result-card"><h1>نمایش سفارش ممکن نیست</h1><p>{error}</p><a className="cart-checkout" href="/menu">بازگشت به منو</a></div></section>;
  if (!order) return null;
  const address = order.deliveryAddressSnapshot;
  return <section className="checkout-result-shell" aria-labelledby="checkout-result-title">
    <div className="checkout-result-card">
      <span className="checkout-result-icon" aria-hidden="true">✓</span>
      <span className="checkout-result-status">{statusLabels[order.status] ?? "سفارش ثبت شد"}</span>
      <h1 id="checkout-result-title">سفارش شما با موفقیت ثبت شد</h1>
      <p>سفارش شما در کافه بررسی می‌شود و وضعیت آن از طریق پیامک اطلاع رسانی میشود.</p>
      <dl className="checkout-result-meta"><div><dt>شماره سفارش</dt><dd dir="ltr">{order.id.slice(0, 8).toUpperCase()}</dd></div><div><dt>مبلغ سفارش</dt><dd>{formatToman(order.totalAmountToman)}</dd></div><div><dt>روش دریافت</dt><dd>{order.deliveryMethod === "COURIER" ? "ارسال با پیک" : "تحویل در کافه"}</dd></div><div><dt>روش پرداخت</dt><dd>پرداخت حضوری</dd></div></dl>
      {address && <p className="checkout-result-address"><strong>نشانی ارسال</strong>{[address.city, address.addressLine, address.buildingNumber && `پلاک ${address.buildingNumber}`, address.unit && `واحد ${address.unit}`].filter(Boolean).join("، ")}</p>}
      {order.customerNote && <p className="checkout-result-note"><strong>یادداشت شما</strong>{order.customerNote}</p>}
      <div className="checkout-result-actions"><a className="cart-checkout" href="/menu">بازگشت به منو</a><a className="checkout-back-cart" href="/cart">مشاهده سبد خرید</a></div>
    </div>
  </section>;
}
