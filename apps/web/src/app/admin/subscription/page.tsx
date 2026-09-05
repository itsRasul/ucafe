"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Subscription = { status: string; trialEndsAt: string | null; currentPeriodEndsAt: string | null; graceEndsAt: string | null; plan: { name: string; priceToman?: string } };
type Checkout = { paymentUrl: string };
const labels: Record<string, string> = { TRIALING: "دوره آزمایشی", ACTIVE: "فعال", GRACE: "مهلت پرداخت", SUSPENDED: "تعلیق", CANCELED: "لغوشده" };
function date(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(value)) : "—"; }

export default function SubscriptionPage() {
  const { access, api } = useAdminSession();
  const [subscription, setSubscription] = useState<Subscription>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canRead = access.permissions.includes("subscription.read");
  const canCheckout = access.permissions.includes("subscription.checkout");
  useEffect(() => { if (canRead) api<Subscription>("/tenant/subscription").then(setSubscription).catch((reason: Error) => setError(reason.message)); }, [api, canRead]);

  async function checkout() {
    setBusy(true); setError("");
    try {
      const key = `web-${crypto.randomUUID()}`;
      const result = await api<Checkout>("/tenant/payments/checkout", { method: "POST", body: JSON.stringify({ planKey: "silver", idempotencyKey: key }) });
      if (!result.paymentUrl) throw new Error("نشانی پرداخت دریافت نشد.");
      window.location.assign(result.paymentUrl);
    } catch (reason) { setError((reason as Error).message); setBusy(false); }
  }

  if (!canRead) return <section className="admin-section-state"><p className="eyebrow">دسترسی محدود</p><h1>اشتراک</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p><Link href="/admin">بازگشت به نمای کلی</Link></section>;
  if (!subscription && !error) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال بارگذاری اشتراک…</h1></section>;
  return <section className="admin-readonly-section"><header><div><p className="eyebrow">مدیریت کافه</p><h1>اشتراک</h1></div><span>پرداخت پیش‌پرداخت</span></header>{subscription && <div className="admin-summary-grid"><article><small>طرح فعلی</small><strong>{subscription.plan.name}</strong></article><article><small>وضعیت</small><strong>{labels[subscription.status] ?? subscription.status}</strong></article><article><small>پایان دوره</small><strong>{date(subscription.currentPeriodEndsAt ?? subscription.trialEndsAt)}</strong></article><article><small>پایان مهلت</small><strong>{date(subscription.graceEndsAt)}</strong></article></div>}<div className="admin-coming-soon"><strong>تمدید یک‌ماهه طرح نقره‌ای</strong><p>مبلغ و مشخصات طرح هنگام ساخت پرداخت ثبت می‌شود و فقط پس از تأیید سمت سرور، اشتراک تمدید یا دوباره فعال خواهد شد.</p>{canCheckout ? <button type="button" onClick={checkout} disabled={busy}>{busy ? "در حال انتقال…" : "پرداخت و تمدید"}</button> : <p>فقط مالک کافه اجازه آغاز پرداخت را دارد.</p>}{error && <p className="admin-message error" role="alert">{error}</p>}</div></section>;
}
