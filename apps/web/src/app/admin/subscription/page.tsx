"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";

type Feature = { key: string; label: string; type: "BOOLEAN" | "NUMBER" | "UNLIMITED" | "TEXT"; value: boolean | number | string | null };
type Plan = { id: string; key: string; name: string; description: string; priceToman: string; billingMonths: number; updatedAt: string; highlightedFeatures: Feature[]; features: Feature[]; relationship: "CURRENT" | "PENDING" | "AVAILABLE"; action: { type: Action; enabled: boolean } };
type Action = "PURCHASE" | "RENEW" | "UPGRADE" | "SCHEDULE_DOWNGRADE" | "CHANGE_DOWNGRADE" | "REACTIVATE" | "TRIAL_TO_PAID" | "NONE";
type Summary = { status: string; trialEndsAt: string | null; currentPeriodStartedAt: string | null; currentPeriodEndsAt: string | null; paidThroughAt: string | null; graceEndsAt: string | null; daysUntilPeriodEnd: number | null; isRenewalWarning: boolean; version: number; pendingChange: { plan: { name: string; key: string }; effectiveAt: string } | null; plan: { key: string; name: string; priceToman: string; billingMonths: number; graceDays: number } };
type Catalog = { trialCard: { name: string; endsAt: string | null; features: Feature[] } | null; plans: Plan[] };
type Quote = { action: Action; subscriptionVersion: number; targetPlan: { key: string; name: string; updatedAt: string }; sourcePlan: { name: string } | null; amountToman: string; pricing: { sourceCreditToman: string; targetCostToman: string; amountDueToman: string }; effectiveTiming: "ON_PAYMENT" | "PERIOD_END" | "NONE"; periodStartedAt: string | null; periodEndsAt: string | null; currentAccessEndsAt: string | null };

const statusLabels: Record<string, string> = { TRIALING: "دوره آزمایشی", ACTIVE: "فعال", GRACE: "مهلت پرداخت", SUSPENDED: "تعلیق", CANCELED: "لغوشده" };
const nf = new Intl.NumberFormat("fa-IR");
const money = (value: string) => `${nf.format(Number(value))} تومان`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "long" }).format(new Date(value)) : "—";
const days = (value: number | null) => value == null ? "—" : value === 0 ? "امروز" : `${nf.format(Math.max(0, value))} روز`;
const actionLabel = (plan: Plan) => ({ PURCHASE: `انتخاب ${plan.name}`, RENEW: "تمدید", UPGRADE: `ارتقا به ${plan.name}`, SCHEDULE_DOWNGRADE: `تنزل به ${plan.name}`, CHANGE_DOWNGRADE: `تغییر به ${plan.name}`, REACTIVATE: `فعال‌سازی ${plan.name}`, TRIAL_TO_PAID: `ارتقا به ${plan.name}`, NONE: "در دسترس نیست" })[plan.action.type];
const operationTitle = (action: Action) => ({ RENEW: "تأیید تمدید اشتراک", UPGRADE: "تأیید ارتقای پلن", SCHEDULE_DOWNGRADE: "تأیید تنزل پلن", CHANGE_DOWNGRADE: "تغییر پلن آینده", REACTIVATE: "فعال‌سازی دوباره", TRIAL_TO_PAID: "پایان دوره آزمایشی", PURCHASE: "خرید اشتراک", NONE: "" })[action];

export default function SubscriptionPage() {
  const router = useRouter();
  const { access, api } = useAdminSession();
  const [summary, setSummary] = useState<Summary>();
  const [catalog, setCatalog] = useState<Catalog>();
  const [quote, setQuote] = useState<Quote>();
  const [cancelPending, setCancelPending] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const canRead = access.permissions.includes("subscription.read");
  const canCheckout = access.permissions.includes("subscription.checkout");

  const load = useCallback(async () => {
    if (!canRead) return;
    setError("");
    try { const [nextSummary, nextCatalog] = await Promise.all([api<Summary>("/tenant/subscription"), api<Catalog>("/tenant/subscription/plans")]); setSummary(nextSummary); setCatalog(nextCatalog); }
    catch (reason) { setError((reason as Error).message); }
  }, [api, canRead]);
  useEffect(() => { void load(); }, [load]);

  async function choose(plan: Plan) {
    if (!plan.action.enabled || !canCheckout) return;
    setBusy(true); setError("");
    try { setQuote(await api<Quote>("/tenant/subscription/preview", { method: "POST", body: JSON.stringify({ planKey: plan.key }) })); setCancelPending(false); dialog.current?.showModal(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function askCancelPending() { setQuote(undefined); setCancelPending(true); dialog.current?.showModal(); }

  async function confirmAction() {
    if (!summary) return;
    setBusy(true); setError("");
    try {
      if (cancelPending) {
        await api("/tenant/subscription/pending-plan", { method: "DELETE", body: JSON.stringify({ expectedSubscriptionVersion: summary.version }) });
        dialog.current?.close(); await load(); return;
      }
      if (!quote) return;
      if (quote.action === "SCHEDULE_DOWNGRADE" || quote.action === "CHANGE_DOWNGRADE") {
        await api("/tenant/subscription/pending-plan", { method: "PUT", body: JSON.stringify({ planKey: quote.targetPlan.key, expectedSubscriptionVersion: quote.subscriptionVersion }) });
        dialog.current?.close(); await load(); return;
      }
      const invoice = await api<{ id: string }>("/tenant/payments/checkout", { method: "POST", body: JSON.stringify({ planKey: quote.targetPlan.key, idempotencyKey: `web-${crypto.randomUUID()}`, expectedSubscriptionVersion: quote.subscriptionVersion, expectedPlanUpdatedAt: quote.targetPlan.updatedAt }) });
      router.push(`/admin/subscription/invoice/${invoice.id}`);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  if (!canRead) return <section className="admin-section-state"><h1>اشتراک</h1><p>نقش شما اجازه مشاهده این بخش را ندارد.</p><Link href="/admin">بازگشت به نمای کلی</Link></section>;
  if ((!summary || !catalog) && !error) return <section className="admin-section-state loading-state" aria-live="polite"><span className="admin-spinner" /><h1>در حال آماده‌سازی پلن‌ها…</h1></section>;
  const allFeatures = catalog?.plans[0]?.features.map(({ key, label, type }) => ({ key, label, type })) ?? [];
  return <section className="admin-readonly-section subscription-workspace">
    <header><div><h1>اشتراک کافه</h1><p>پلن، زمان باقی‌مانده و تغییر بعدی اشتراک را یک‌جا مدیریت کنید.</p></div><Link className="admin-preview-link" href="/admin/invoices">سوابق پرداخت</Link></header>
    {error && <p className="admin-message error" role="alert">{error}</p>}
    {summary && catalog && <>
      <section className={`subscription-status-panel state-${summary.status.toLowerCase()}`} aria-label="وضعیت فعلی اشتراک">
        <div><span>{statusLabels[summary.status] ?? summary.status}</span><h2>{summary.plan.name}</h2><p>{summary.status === "GRACE" ? `مهلت پرداخت تا ${date(summary.graceEndsAt)}` : summary.status === "SUSPENDED" ? "اشتراک منقضی شده و برای فعال‌سازی دوباره آماده است." : `اعتبار تا ${date(summary.paidThroughAt ?? summary.trialEndsAt)}`}</p></div>
        <dl><div><dt>زمان باقی‌مانده</dt><dd>{days(summary.daysUntilPeriodEnd)}</dd></div><div><dt>پایان اعتبار</dt><dd>{date(summary.paidThroughAt ?? summary.trialEndsAt)}</dd></div><div><dt>وضعیت</dt><dd>{statusLabels[summary.status]}</dd></div></dl>
      </section>
      {summary.pendingChange && <section className="pending-plan-banner"><div><strong>تغییر برنامه‌ریزی‌شده به {summary.pendingChange.plan.name}</strong><p>پلن فعلی تا {date(summary.pendingChange.effectiveAt)} فعال می‌ماند.</p></div>{canCheckout && <button type="button" onClick={askCancelPending}>لغو تغییر</button>}</section>}

      <section className="subscription-plans" aria-labelledby="plans-title">
        <div className="subscription-section-heading"><div><h2 id="plans-title">پلن‌های قابل انتخاب</h2><p>قیمت و امکان هر پلن مستقیماً از تنظیمات پلتفرم دریافت می‌شود.</p></div><a href="#plan-comparison">مقایسه کامل امکانات</a></div>
        <div className="plan-card-grid">
          {catalog.trialCard && <article className="plan-card active trial-card"><div className="plan-card-title"><div><span>فعال</span><h3>{catalog.trialCard.name}</h3></div><strong>رایگان</strong></div><p>فرصت آشنایی با امکانات پلن فعلی تا {date(catalog.trialCard.endsAt)}.</p><ul>{catalog.trialCard.features.filter((feature) => feature.value === true).map((feature) => <li key={feature.key}>{feature.label}</li>)}</ul><button disabled>دوره فعال</button></article>}
          {catalog.plans.map((plan) => <article className={`plan-card ${plan.relationship === "CURRENT" && summary.status !== "TRIALING" ? "active" : ""} ${plan.relationship === "PENDING" ? "pending" : ""}`} key={plan.id}>
            <div className="plan-card-title"><div>{plan.relationship === "CURRENT" && summary.status !== "TRIALING" && <span>پلن فعال</span>}{plan.relationship === "PENDING" && <span>پلن آینده</span>}<h3>{plan.name}</h3></div><strong>{money(plan.priceToman)}<small> / {nf.format(plan.billingMonths)} ماه</small></strong></div>
            <p>{plan.description || "پلن اشتراک یو کافه با امکانات قابل مدیریت."}</p>
            <ul>{plan.highlightedFeatures.map((feature) => <li key={feature.key}>{feature.label}</li>)}</ul>
            <div className="plan-card-actions"><button type="button" disabled={!plan.action.enabled || !canCheckout || busy} onClick={() => void choose(plan)}>{actionLabel(plan)}</button><a href="#plan-comparison">مشاهده امکانات</a></div>
          </article>)}
        </div>
      </section>

      <section className="plan-comparison" id="plan-comparison" aria-labelledby="comparison-title"><div className="subscription-section-heading"><div><h2 id="comparison-title">مقایسه امکانات</h2><p>امکانات واقعی هر پلن؛ بدون اطلاعات ثابت در رابط کاربری.</p></div></div><div className="comparison-scroll"><table><thead><tr><th scope="col">امکانات</th>{catalog.plans.map((plan) => <th scope="col" key={plan.id}>{plan.name}</th>)}</tr></thead><tbody>{allFeatures.map((feature) => <tr key={feature.key}><th scope="row">{feature.label}</th>{catalog.plans.map((plan) => { const value = plan.features.find((item) => item.key === feature.key)?.value; return <td key={plan.id}>{typeof value === "boolean" ? <span className={value ? "feature-yes" : "feature-no"} aria-label={value ? "دارد" : "ندارد"}>{value ? "دارد" : "ندارد"}</span> : value == null ? "—" : String(value)}</td>; })}</tr>)}</tbody></table></div></section>
    </>}

    <dialog ref={dialog} className="subscription-dialog" onClose={() => { setQuote(undefined); setCancelPending(false); }}>
      <form method="dialog"><button className="dialog-close" aria-label="بستن" disabled={busy}>بستن</button></form>
      <h2>{cancelPending ? "لغو تغییر پلن" : quote ? operationTitle(quote.action) : "تأیید عملیات"}</h2>
      {cancelPending ? <p>تغییر برنامه‌ریزی‌شده لغو می‌شود و پلن فعلی بدون تغییر ادامه پیدا می‌کند.</p> : quote && <><p>{quote.action === "UPGRADE" ? `پلن ${quote.targetPlan.name} پس از پرداخت فعال می‌شود و تاریخ پایان فعلی تغییر نمی‌کند.` : quote.action === "SCHEDULE_DOWNGRADE" || quote.action === "CHANGE_DOWNGRADE" ? `پلن فعلی تا ${date(quote.periodStartedAt)} فعال می‌ماند و سپس ${quote.targetPlan.name} جایگزین می‌شود.` : quote.action === "REACTIVATE" ? "دوره تازه از زمان پرداخت موفق آغاز می‌شود." : quote.action === "TRIAL_TO_PAID" ? "دوره آزمایشی با پرداخت موفق پایان می‌یابد و پلن پولی همان لحظه فعال می‌شود." : `دوره بعدی از ${date(quote.periodStartedAt)} آغاز می‌شود.`}</p><dl>{quote.action === "UPGRADE" && <><div><dt>اعتبار پلن فعلی</dt><dd>{money(quote.pricing.sourceCreditToman)}</dd></div><div><dt>هزینه پلن جدید</dt><dd>{money(quote.pricing.targetCostToman)}</dd></div></>}<div><dt>مبلغ قابل پرداخت</dt><dd>{money(quote.amountToman)}</dd></div>{quote.periodEndsAt && <div><dt>پایان اعتبار</dt><dd>{date(quote.periodEndsAt)}</dd></div>}</dl></>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={() => void confirmAction()}>{busy ? "در حال ثبت…" : cancelPending ? "لغو تغییر پلن" : quote?.action === "SCHEDULE_DOWNGRADE" || quote?.action === "CHANGE_DOWNGRADE" ? "ثبت تغییر" : "ساخت فاکتور"}</button><button type="button" className="secondary" disabled={busy} onClick={() => dialog.current?.close()}>بازگشت</button></div>
    </dialog>
  </section>;
}
