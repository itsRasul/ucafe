"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAdminSession } from "../admin-session";

type Subscription = { status: string; trialEndsAt: string | null; currentPeriodEndsAt: string | null; graceEndsAt: string | null; daysUntilPeriodEnd: number | null; isRenewalWarning: boolean; plan: { key: string; name: string; priceToman: string; billingMonths: number; graceDays: number } };
type Invoice = { id: string };
const labels: Record<string, string> = { TRIALING: "دوره آزمایشی", ACTIVE: "فعال", GRACE: "مهلت پرداخت", SUSPENDED: "تعلیق", CANCELED: "لغوشده" };
const nf = new Intl.NumberFormat("fa-IR");
function date(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(value)) : "—"; }
function daysText(value: number | null) { if (value == null) return "—"; if (value < 0) return "پایان‌یافته"; if (value === 0) return "امروز"; return `${nf.format(value)} روز`; }

export default function SubscriptionPage() {
  const router = useRouter();
  const { access, api } = useAdminSession();
  const [subscription, setSubscription] = useState<Subscription>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canRead = access.permissions.includes("subscription.read");
  const canCheckout = access.permissions.includes("subscription.checkout");
  useEffect(() => { if (canRead) api<Subscription>("/tenant/subscription").then(setSubscription).catch((reason: Error) => setError(reason.message)); }, [api, canRead]);

  async function createInvoice() {
    setBusy(true); setError("");
    try {
      const key = `web-${crypto.randomUUID()}`;
      const result = await api<Invoice>("/tenant/payments/checkout", { method: "POST", body: JSON.stringify({ planKey: "silver", idempotencyKey: key }) });
      router.push(`/admin/subscription/invoice/${result.id}`);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  if (!canRead) return <section className="admin-section-state"><h1>اشتراک</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p><Link href="/admin">بازگشت به نمای کلی</Link></section>;
  if (!subscription && !error) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال بارگذاری اشتراک…</h1></section>;
  return <section className="admin-readonly-section subscription-workspace">
    <header><div><h1>اشتراک کافه</h1><p>تمدید اشتراک از مسیر امن پرداخت انجام می‌شود و فقط بعد از تأیید بانک فعال می‌شود.</p></div><Link className="admin-preview-link" href="/admin/invoices">سوابق پرداخت</Link></header>
    {subscription && <>
      {subscription.isRenewalWarning && <p className="admin-message warning" role="alert">مهلت دوره فعلی رو به پایان است. برای جلوگیری از قطع نمایش سایت کافه، تمدید را پیش از پایان مهلت انجام دهید.</p>}
      <div className="admin-summary-grid">
        <article><small>طرح فعلی</small><strong>{subscription.plan.name}</strong></article>
        <article><small>وضعیت</small><strong>{labels[subscription.status] ?? subscription.status}</strong></article>
        <article><small>پایان دوره</small><strong>{date(subscription.currentPeriodEndsAt ?? subscription.trialEndsAt)}</strong></article>
        <article><small>زمان باقی‌مانده</small><strong>{daysText(subscription.daysUntilPeriodEnd)}</strong></article>
      </div>
      <div className="billing-panel">
        <div><h2>تمدید یک‌ماهه</h2><p>فاکتور تمدید با مبلغ فعلی طرح ساخته می‌شود. اگر پرداخت موفق باشد، دوره جدید از پایان دوره قبلی محاسبه می‌شود.</p></div>
        <dl><div><dt>مبلغ</dt><dd>{nf.format(Number(subscription.plan.priceToman))} تومان</dd></div><div><dt>مهلت پرداخت پس از پایان دوره</dt><dd>{nf.format(subscription.plan.graceDays)} روز</dd></div><div><dt>پایان مهلت فعلی</dt><dd>{date(subscription.graceEndsAt)}</dd></div></dl>
        {canCheckout ? <button type="button" onClick={createInvoice} disabled={busy}>{busy ? "در حال ساخت فاکتور…" : "تمدید اشتراک"}</button> : <p>فقط مالک کافه اجازه آغاز پرداخت را دارد.</p>}
      </div>
    </>}
    {error && <p className="admin-message error" role="alert">{error}</p>}
  </section>;
}
