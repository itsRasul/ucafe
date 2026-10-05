"use client";

import { useState } from "react";
import { PublicCatalog, persianNumber, toman } from "./platform-catalog";
import { Button, ButtonLink } from "./ui/primitives";
import { buildPlanComparisonRows, planCardFeatureRows } from "./plan-presentation.js";

export function PlatformPricing({ initialCatalog }: { initialCatalog: PublicCatalog | null }) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function retry() {
    setBusy(true); setError("");
    try { const response = await fetch("/api/backend/public/platform/plans", { cache: "no-store" }); if (!response.ok) throw new Error(); setCatalog(await response.json() as PublicCatalog); }
    catch { setError("دریافت تعرفه‌ها انجام نشد. دوباره تلاش کنید یا درخواست مشاوره بفرستید."); }
    finally { setBusy(false); }
  }
  if (busy) return <div className="uc-pricing-loading" aria-busy="true" role="status"><p>در حال دریافت تعرفه‌های روز…</p><div className="uc-pricing-grid">{[0, 1, 2].map((i) => <div className="uc-pricing-skeleton" key={i} />)}</div></div>;
  if (!catalog?.plans.length) return <div className="uc-catalog-unavailable"><h3>تعرفه‌ها فعلاً در دسترس نیستند.</h3><p>برای دریافت اطلاعات اشتراک، دوباره تلاش کنید یا با ما در ارتباط باشید.</p><div className="uc-actions"><Button onClick={retry}>دریافت دوباره تعرفه‌ها</Button><ButtonLink href="#request" variant="outline">مشاوره رایگان</ButtonLink></div>{error && <p role="alert" className="uc-alert uc-alert--error">{error}</p>}</div>;
  const comparisonRows = buildPlanComparisonRows(catalog.featureCatalog, catalog.plans);
  return <><div className="uc-pricing-grid">{catalog.plans.map((plan) => { const features = planCardFeatureRows(plan.features, plan.displayFeatures); return <article className="uc-price-card" key={plan.key}><div><h3>{plan.name}</h3><p>{plan.description || "اشتراک ابزارهای مدیریت کافه"}</p></div><p className="uc-plan-price"><strong>{toman(plan.priceToman)}</strong><span>تومان / {persianNumber(plan.billingMonths)} ماه</span></p>{features.length ? <ul>{features.map((feature) => <li key={feature.key}><span className={feature.checked ? "uc-check" : "uc-feature-value-marker"} aria-hidden="true" />{feature.label}</li>)}</ul> : <p className="uc-plan-empty">امکاناتی برای نمایش ثبت نشده است.</p>}<ButtonLink href={`/start?plan=${encodeURIComponent(plan.key)}`} size="lg">انتخاب {plan.name}</ButtonLink><small>پرداخت برای یک دوره {persianNumber(plan.billingMonths)} ماهه؛ تمدید خودکار ندارد.</small></article>; })}</div>
    <div className="uc-comparison"><h3>دقیقاً چه امکاناتی دریافت می‌کنید؟</h3><table className="uc-comparison-table"><caption className="uc-sr-only">مقایسه کامل امکانات کاربردی و نمایشی پلن‌ها بر اساس تنظیمات فعلی یوکافه</caption><thead><tr><th scope="col">امکانات</th>{catalog.plans.map((plan) => <th scope="col" key={plan.key}>{plan.name}</th>)}</tr></thead><tbody>{comparisonRows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th>{catalog.plans.map((plan) => { const value = row.values[plan.key]; return <td key={plan.key}>{row.kind === "functional" ? value ? <span className="uc-feature-yes">دارد</span> : <span>ندارد</span> : value ?? "—"}</td>; })}</tr>)}</tbody></table>
      <div className="uc-comparison-mobile">{catalog.plans.map((plan) => <details key={plan.key}><summary>امکانات {plan.name}<span aria-hidden="true" /></summary><dl>{comparisonRows.map((row) => { const value = row.values[plan.key]; return <div key={row.key}><dt>{row.label}</dt><dd className={row.kind === "functional" && value === true ? "uc-feature-yes" : ""}>{row.kind === "functional" ? value ? "دارد" : "ندارد" : value ?? "—"}</dd></div>; })}</dl></details>)}</div>
    </div><p className="uc-pricing-note">وب‌سایت، پنل مشتری و پشتیبانی در ساختار پلتفرم ارائه می‌شوند؛ جدول بالا دسترسی به ماژول‌های قابل تنظیم هر پلن را نشان می‌دهد. مبلغ نهایی پیش از پرداخت دوباره توسط سرور بررسی می‌شود.</p></>;
}
