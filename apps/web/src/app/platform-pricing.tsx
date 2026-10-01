"use client";

import { useState } from "react";
import { PublicCatalog, persianNumber, toman } from "./platform-catalog";
import { Button, ButtonLink } from "./ui/primitives";

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
  const features = catalog.plans[0]!.features;
  return <><div className="uc-pricing-grid">{catalog.plans.map((plan) => <article className="uc-price-card" key={plan.key}><div><h3>{plan.name}</h3><p>{plan.description || "اشتراک ابزارهای مدیریت کافه"}</p></div><p className="uc-plan-price"><strong>{toman(plan.priceToman)}</strong><span>تومان / {persianNumber(plan.billingMonths)} ماه</span></p><ul>{(plan.highlightedFeatures.length ? plan.highlightedFeatures : plan.features.filter((feature) => feature.included)).map((feature) => <li key={feature.key}><span className="uc-check" aria-hidden="true" />{feature.label}</li>)}</ul><ButtonLink href={`/start?plan=${encodeURIComponent(plan.key)}`} size="lg">انتخاب {plan.name}</ButtonLink><small>پرداخت برای یک دوره {persianNumber(plan.billingMonths)} ماهه؛ تمدید خودکار ندارد.</small></article>)}</div>
    <div className="uc-comparison"><h3>دقیقاً چه امکاناتی دریافت می‌کنید؟</h3><table className="uc-comparison-table"><caption className="uc-sr-only">مقایسه امکانات پلن‌ها بر اساس تنظیمات فعلی یوکافه</caption><thead><tr><th scope="col">امکانات</th>{catalog.plans.map((plan) => <th scope="col" key={plan.key}>{plan.name}</th>)}</tr></thead><tbody>{features.map((feature) => <tr key={feature.key}><th scope="row">{feature.label}</th>{catalog.plans.map((plan) => <td key={plan.key}>{plan.features.find((item) => item.key === feature.key)?.included ? <span className="uc-feature-yes">دارد</span> : <span>ندارد</span>}</td>)}</tr>)}</tbody></table>
      <div className="uc-comparison-mobile">{catalog.plans.map((plan) => <details key={plan.key}><summary>امکانات {plan.name}<span aria-hidden="true" /></summary><dl>{plan.features.map((feature) => <div key={feature.key}><dt>{feature.label}</dt><dd className={feature.included ? "uc-feature-yes" : ""}>{feature.included ? "دارد" : "ندارد"}</dd></div>)}</dl></details>)}</div>
    </div><p className="uc-pricing-note">وب‌سایت، پنل مشتری و پشتیبانی در ساختار پلتفرم ارائه می‌شوند؛ جدول بالا دسترسی به ماژول‌های قابل تنظیم هر پلن را نشان می‌دهد. مبلغ نهایی پیش از پرداخت دوباره توسط سرور بررسی می‌شود.</p></>;
}
