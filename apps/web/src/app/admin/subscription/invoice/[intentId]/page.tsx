"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useAdminSession } from "../../../admin-session";

type Subscription = { currentPeriodEndsAt: string | null; trialEndsAt: string | null; plan: { billingMonths: number } };
type Invoice = { id: string; status: string; amountToman: string; plan: { name: string }; providerReference: string | null; createdAt: string; expiresAt: string; paymentUrl?: string };
const statusLabels: Record<string, string> = { PENDING: "در انتظار پرداخت", VERIFYING: "در حال بررسی", PAID: "پرداخت‌شده", FAILED: "ناموفق", EXPIRED: "منقضی" };
const nf = new Intl.NumberFormat("fa-IR");
function date(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(value)) : "—"; }
function addMonths(value: string | null, months: number) { if (!value) return null; const d = new Date(value); d.setUTCMonth(d.getUTCMonth() + months); return d.toISOString(); }

export default function InvoicePage() {
  const params = useParams<{ intentId: string }>();
  const { access, api } = useAdminSession();
  const [invoice, setInvoice] = useState<Invoice>();
  const [subscription, setSubscription] = useState<Subscription>();
  const [error, setError] = useState("");
  const canRead = access.permissions.includes("subscription.read");
  const canCheckout = access.permissions.includes("subscription.checkout");
  useEffect(() => {
    if (!canRead) return;
    Promise.all([api<Invoice>(`/tenant/payments/invoices/${params.intentId}`), api<Subscription>("/tenant/subscription")])
      .then(([nextInvoice, nextSubscription]) => { setInvoice(nextInvoice); setSubscription(nextSubscription); })
      .catch((reason: Error) => setError(reason.message));
  }, [api, canRead, params.intentId]);
  if (!canRead) return <section className="admin-section-state"><h1>فاکتور</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p></section>;
  if (!invoice && !error) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال بارگذاری فاکتور…</h1></section>;
  const startsAt = subscription?.currentPeriodEndsAt ?? subscription?.trialEndsAt ?? invoice?.createdAt ?? null;
  const endsAt = addMonths(startsAt, subscription?.plan.billingMonths ?? 1);
  return <section className="admin-readonly-section invoice-detail">
    <header><div><h1>فاکتور تمدید</h1><p>جزئیات پرداخت پیش از انتقال به درگاه.</p></div><Link className="admin-preview-link" href="/admin/invoices">همه فاکتورها</Link></header>
    {error && <p className="admin-message error" role="alert">{error}</p>}
    {invoice && <div className="billing-panel">
      <div className="invoice-title-row"><div><h2>{invoice.plan.name}</h2><p>تمدید اشتراک یو کافه برای یک دوره ماهانه.</p></div><span className={`invoice-status status-${invoice.status.toLowerCase()}`}>{statusLabels[invoice.status] ?? invoice.status}</span></div>
      <dl><div><dt>مبلغ قابل پرداخت</dt><dd>{nf.format(Number(invoice.amountToman))} تومان</dd></div><div><dt>شروع دوره جدید</dt><dd>{date(startsAt)}</dd></div><div><dt>پایان دوره جدید</dt><dd>{date(endsAt)}</dd></div><div><dt>اعتبار فاکتور</dt><dd>{date(invoice.expiresAt)}</dd></div><div><dt>شماره پیگیری</dt><dd dir="ltr">{invoice.providerReference ?? "—"}</dd></div></dl>
      {invoice.paymentUrl && canCheckout ? <a className="admin-preview-link pay-link" href={invoice.paymentUrl}>پرداخت از درگاه</a> : <p className="admin-message warning">{invoice.status === "PAID" ? "این فاکتور پرداخت شده است." : "این فاکتور در حال حاضر قابل پرداخت نیست. در صورت نیاز از بخش اشتراک فاکتور تازه بسازید."}</p>}
    </div>}
  </section>;
}
