"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { formatJalaliDate } from "../../jalali-date";
import { useAdminSession } from "../admin-session";

type Metric = { value: string; previousValue: string; change: string; changePercent: string | null };
type PromotionValues = {
  uses: string; ordersAffected: string; couponRedemptions: string; uniqueCustomers: string; discountedUnits: string;
  grossPromotionalValueToman: string; promotionDiscountToman: string; netPromotionalValueToman: string;
  attributedOrderValueToman: string; averageOrderValueToman: string; averageDiscountPerOrderToman: string;
  averageDiscountRatePercent: string | null;
};
type PromotionRow = {
  promotionId: string; promotionName: string; currentName: string | null; historicalNames: string[];
  status: "ACTIVE" | "INACTIVE" | "ARCHIVED"; types: string[]; scopes: string[];
  activationModes: string[]; couponCodes: string[]; metrics: { current: PromotionValues; previous: PromotionValues };
};
type Series = { key: string; label: string; points: Array<{ bucket: string; label: string; value: string }> };
export type PromotionOverviewData = {
  timezone: string; granularity: "hour" | "day" | "week" | "month" | "year";
  metrics: { ordersWithPromotion: Metric; promotionDiscountToman: Metric; attributedOrderValueToman: Metric; uniqueCustomers: Metric; couponRedemptions: Metric };
  series: { orders: Series; discountToman: Series; attributedOrderValueToman: Series };
  topPromotions: { byUses: PromotionRow[]; byDiscount: PromotionRow[]; byAttributedOrderValue: PromotionRow[] };
  promotions: PromotionRow[]; pagination: { page: number; pageSize: number; total: number; hasMore: boolean };
};

const fa = new Intl.NumberFormat("fa-IR");
const number = (value: string) => fa.format(BigInt(value));
const toman = (value: string) => `${number(value)} تومان`;
const digits = "۰۱۲۳۴۵۶۷۸۹";
const percentage = (value: string | null) => value === null ? "قابل محاسبه نیست" : `${value.replace(/\d/g, (digit) => digits[Number(digit)]!)}٪`;
const statusLabel = (status: PromotionRow["status"]) => status === "ARCHIVED" ? "آرشیو شده" : status === "ACTIVE" ? "فعال" : "غیرفعال";
const modeLabel = (mode: string) => mode === "COUPON" ? "کد تخفیف" : "خودکار";
const typeLabel = (type: string) => ({
  PERCENTAGE: "درصدی", FIXED_AMOUNT: "مبلغ ثابت", FIXED_PRICE: "قیمت ثابت",
  BUY_X_GET_Y: "بخر و هدیه بگیر", BUNDLE: "بسته ترکیبی", QUANTITY_TIER: "تخفیف تعدادی",
}[type] ?? type);
const scopeLabel = (scope: string) => scope === "ORDER" ? "سطح سفارش" : "محصول";

function Trend({ data, granularity, timezone, title = "روند عملکرد تخفیف‌ها", description = "بر پایه زمان تحویل سفارش در منطقه زمانی کافه" }: { data: PromotionOverviewData["series"]; granularity: PromotionOverviewData["granularity"]; timezone: string; title?: string; description?: string }) {
  const [selected, setSelected] = useState<keyof PromotionOverviewData["series"]>("discountToman");
  const series = data[selected];
  const [active, setActive] = useState(0);
  const points = series.points;
  const width = Math.max(680, points.length * 31 + 58);
  const peak = points.reduce((max, point) => BigInt(point.value) > max ? BigInt(point.value) : max, BigInt(0));
  const step = points.length < 2 ? 0 : (width - 70) / (points.length - 1);
  const xy = points.map((point, index) => ({ x: 35 + step * index, y: 160 - Number(BigInt(point.value) * BigInt(116) / (peak || BigInt(1))) }));
  const current = points[Math.min(active, Math.max(0, points.length - 1))];
  const label = (bucket: string) => granularity === "hour"
    ? new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(bucket))
    : formatJalaliDate(bucket.slice(0, 10));
  const display = (value: string) => selected === "orders" ? number(value) : toman(value);
  return <section className="analytics-trend promotion-trend" aria-label={title}>
    <header><div><h2>{title}</h2><p>{description}</p></div>{current && <div className="analytics-chart-reading"><strong>{display(current.value)}</strong><span>{label(current.bucket)}</span></div>}</header>
    <div className="analytics-metric-switch" role="group" aria-label="معیار نمودار">
      <button type="button" aria-pressed={selected === "orders"} onClick={() => { setSelected("orders"); setActive(0); }}>سفارش‌ها</button>
      <button type="button" aria-pressed={selected === "discountToman"} onClick={() => { setSelected("discountToman"); setActive(0); }}>مبلغ تخفیف</button>
      <button type="button" aria-pressed={selected === "attributedOrderValueToman"} onClick={() => { setSelected("attributedOrderValueToman"); setActive(0); }}>ارزش سفارش مرتبط</button>
    </div>
    <div className="analytics-chart-scroll" tabIndex={0} aria-label={`نمودار ${series.label}; برای دیدن همه بازه‌ها پیمایش کنید`}>
      <svg width={width} height="220" viewBox={`0 0 ${width} 220`} role="img" aria-label={`${series.label} در ${points.length} بازه`}>
        {[44, 102, 160].map((y) => <line key={y} className="analytics-grid-line" x1="35" y1={y} x2={width - 35} y2={y} />)}
        <polyline className="analytics-line" points={xy.map(({ x, y }) => `${x},${y}`).join(" ")} />
        {points.map((point, index) => <g key={point.bucket}>
          <circle className={`analytics-dot ${active === index ? "active" : ""}`} cx={xy[index]!.x} cy={xy[index]!.y} r={active === index ? 5 : 3.5} tabIndex={0} role="button" aria-label={`${label(point.bucket)}: ${display(point.value)}`} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setActive(index); } }}><title>{label(point.bucket)}: {display(point.value)}</title></circle>
          {(index % Math.max(1, Math.ceil(points.length / 7)) === 0 || index === points.length - 1) && <text className="analytics-axis-label" x={xy[index]!.x} y="198" textAnchor="middle">{label(point.bucket)}</text>}
        </g>)}
      </svg>
    </div>
  </section>;
}

function TopList({ title, rows, field }: { title: string; rows: PromotionRow[]; field: "uses" | "discount" | "sales" }) {
  const value = (row: PromotionRow) => field === "uses" ? number(row.metrics.current.uses) : toman(field === "discount" ? row.metrics.current.promotionDiscountToman : row.metrics.current.attributedOrderValueToman);
  return <section className="analytics-time-panel promotion-top-list"><h2>{title}</h2>{rows.length ? <ol>{rows.map((row) => <li key={row.promotionId}><Link href={`/admin/analytics/promotions/${row.promotionId}`}><span>{row.promotionName}</span><strong>{value(row)}</strong></Link></li>)}</ol> : <p className="analytics-table-empty">داده‌ای در این بازه وجود ندارد.</p>}</section>;
}

export function PromotionAnalyticsView({ periodQuery }: { periodQuery: string }) {
  const { api } = useAdminSession();
  const [activation, setActivation] = useState("");
  const [status, setStatus] = useState("");
  const [promotionType, setPromotionType] = useState("");
  const [sortBy, setSortBy] = useState("uses");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<PromotionOverviewData | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [retry, setRetry] = useState(0);
  const query = useMemo(() => {
    const params = new URLSearchParams(periodQuery);
    params.set("page", String(page)); params.set("pageSize", "20"); params.set("sortBy", sortBy);
    if (activation) params.set("activation", activation); else params.delete("activation");
    if (status) params.set("status", status); else params.delete("status");
    if (promotionType) params.set("promotionType", promotionType); else params.delete("promotionType");
    return params.toString();
  }, [activation, page, periodQuery, promotionType, sortBy, status]);
  useEffect(() => {
    const controller = new AbortController(); setBusy(true); setError(""); setUnavailable(false);
    api<PromotionOverviewData>(`/tenant/analytics/promotions?${query}`, { signal: controller.signal })
      .then(setData)
      .catch((reason: Error & { code?: string }) => { if (controller.signal.aborted) return; if (reason.code === "FEATURE_UNAVAILABLE") setUnavailable(true); else setError(reason.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [api, query, retry]);
  const clearFilters = () => { setActivation(""); setStatus(""); setPromotionType(""); setSortBy("uses"); setPage(1); };
  if (unavailable) return <div className="analytics-state"><h2>آمار و تحلیل در اشتراک فعلی فعال نیست</h2><p>برای بررسی پلن‌های دارای این امکان، صفحه اشتراک را ببینید.</p><Link href="/admin/subscription">مشاهده پلن‌ها</Link></div>;
  if (error) return <div className="analytics-state" role="alert"><h2>گزارش تخفیف‌ها دریافت نشد</h2><p>{error}</p><button type="button" onClick={() => setRetry((value) => value + 1)}>تلاش دوباره</button></div>;
  if (busy && !data) return <div className="analytics-loading" role="status"><span className="admin-spinner" />در حال آماده‌سازی گزارش…</div>;
  if (!data) return null;
  const activeFilterCount = Number(Boolean(activation)) + Number(Boolean(status)) + Number(Boolean(promotionType));
  return <div className="analytics-results promotion-analytics" aria-busy={busy}>
    <div className="analytics-kpis promotion-kpis">
      <article className="analytics-kpi"><span>سفارش‌های دارای تخفیف</span><strong>{number(data.metrics.ordersWithPromotion.value)}</strong><small>در مقایسه با بازه قبل: {percentage(data.metrics.ordersWithPromotion.changePercent)}</small></article>
      <article className="analytics-kpi main"><span>مبلغ تخفیف اختصاص‌یافته</span><strong>{toman(data.metrics.promotionDiscountToman.value)}</strong><small>در مقایسه با بازه قبل: {percentage(data.metrics.promotionDiscountToman.changePercent)}</small></article>
      <article className="analytics-kpi"><span>ارزش سفارش‌های مرتبط</span><strong>{toman(data.metrics.attributedOrderValueToman.value)}</strong><small>سفارش‌های تحویل‌شده دارای تخفیف</small></article>
      <article className="analytics-kpi"><span>مشتریان یکتا</span><strong>{number(data.metrics.uniqueCustomers.value)}</strong><small>کدهای تخفیف: {number(data.metrics.couponRedemptions.value)} استفاده</small></article>
    </div>
    {!data.metrics.ordersWithPromotion.value || data.metrics.ordersWithPromotion.value === "0" ? <div className="analytics-empty"><strong>هنوز سفارشی با تخفیف تحویل نشده است.</strong><p>پس از تحویل سفارش‌های دارای تخفیف، آمار استفاده و مبلغ تخفیف اینجا نمایش داده می‌شود.</p></div> : <Trend data={data.series} granularity={data.granularity} timezone={data.timezone} />}
    <div className="promotion-top-grid"><TopList title="بیشترین استفاده" rows={data.topPromotions.byUses} field="uses" /><TopList title="بیشترین مبلغ تخفیف" rows={data.topPromotions.byDiscount} field="discount" /><TopList title="بیشترین ارزش سفارش مرتبط" rows={data.topPromotions.byAttributedOrderValue} field="sales" /></div>
    <section className="analytics-time-panel promotion-table-panel">
      <header className="promotion-table-heading"><div><h2>مقایسه تخفیف‌ها</h2><p>مرتب‌سازی مستقیم بر اساس معیار انتخابی؛ سفارش‌های مشترک בין چند تخفیف فقط یک‌بار در جمع فروش دیده می‌شوند.</p></div></header>
      <div className="promotion-filters">
        <label>روش فعال‌سازی<select value={activation} onChange={(event) => { setActivation(event.target.value); setPage(1); }}><option value="">همه</option><option value="AUTOMATIC">خودکار</option><option value="COUPON">کد تخفیف</option></select></label>
        <label>نوع تخفیف<select value={promotionType} onChange={(event) => { setPromotionType(event.target.value); setPage(1); }}><option value="">همه انواع</option>{["PERCENTAGE", "FIXED_AMOUNT", "FIXED_PRICE", "BUY_X_GET_Y", "BUNDLE", "QUANTITY_TIER"].map((type) => <option key={type} value={type}>{typeLabel(type)}</option>)}</select></label>
        <label>وضعیت فعلی<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همه وضعیت‌ها</option><option value="ACTIVE">فعال</option><option value="INACTIVE">غیرفعال</option><option value="ARCHIVED">آرشیو شده</option></select></label>
        <label>مرتب‌سازی<select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}><option value="uses">تعداد استفاده</option><option value="discount">مبلغ تخفیف</option><option value="attributedSales">ارزش سفارش مرتبط</option><option value="averageOrderValue">میانگین مبلغ سفارش</option></select></label>
        {activeFilterCount > 0 && <button type="button" onClick={clearFilters}>پاک کردن فیلترها</button>}
      </div>
      <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table promotion-table"><thead><tr><th>تخفیف</th><th>نوع / فعال‌سازی</th><th>وضعیت</th><th>استفاده</th><th>سفارش‌ها</th><th>مشتریان</th><th>تخفیف داده‌شده</th><th>ارزش سفارش مرتبط</th><th>میانگین سفارش</th></tr></thead><tbody>
        {data.promotions.map((row) => <tr key={row.promotionId}>
          <td><Link href={`/admin/analytics/promotions/${row.promotionId}?${periodQuery}`}>{row.promotionName}</Link>{row.couponCodes.length > 0 && <small>{row.couponCodes.join("، ")}</small>}{row.currentName && row.currentName !== row.promotionName && <small>نام فعلی: {row.currentName}</small>}</td>
          <td>{row.types.map(typeLabel).join("، ")}<small>{row.scopes.map(scopeLabel).join("، ")} · {row.activationModes.map(modeLabel).join(" / ")}</small></td>
          <td><span className={`promotion-status ${row.status.toLowerCase()}`}>{statusLabel(row.status)}</span></td>
          <td>{number(row.metrics.current.uses)}<small>کدها: {number(row.metrics.current.couponRedemptions)}</small></td>
          <td>{number(row.metrics.current.ordersAffected)}</td><td>{number(row.metrics.current.uniqueCustomers)}</td>
          <td>{toman(row.metrics.current.promotionDiscountToman)}<small>میانگین: {toman(row.metrics.current.averageDiscountPerOrderToman)}</small></td>
          <td>{toman(row.metrics.current.attributedOrderValueToman)}</td><td>{toman(row.metrics.current.averageOrderValueToman)}</td>
        </tr>)}
      </tbody></table></div>
      {!data.promotions.length && <p className="analytics-table-empty">تخفیفی برای این فیلترها پیدا نشد.</p>}
      {data.pagination.total > data.pagination.pageSize && <div className="promotion-pagination"><button type="button" disabled={data.pagination.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>صفحه قبل</button><span>صفحه {number(String(data.pagination.page))} از {number(String(Math.max(1, Math.ceil(data.pagination.total / data.pagination.pageSize))))}</span><button type="button" disabled={!data.pagination.hasMore} onClick={() => setPage((value) => value + 1)}>صفحه بعد</button></div>}
    </section>
    <p className="analytics-note">یک «استفاده» برابر یک سفارش تحویل‌شده برای آن تخفیف است؛ چند تخصیص یا واحد پاداش در همان سفارش، استفاده تازه‌ای نمی‌سازد. مبلغ سفارش مرتبط، فروش منتسب‌شده است و اثر علّی تخفیف را نشان نمی‌دهد. سفارش‌های پرداخت حضوری هستند و دریافت وجه در سامانه ثبت نمی‌شود.</p>
  </div>;
}

export type PromotionDetailData = {
  timezone: string; granularity: PromotionOverviewData["granularity"];
  promotion: Pick<PromotionRow, "promotionId" | "promotionName" | "currentName" | "historicalNames" | "status" | "types" | "scopes" | "activationModes" | "couponCodes">;
  metrics: { uses: Metric; ordersWithPromotion: Metric; uniqueCustomers: Metric; newCustomers: Metric; returningCustomers: Metric; couponRedemptions: Metric; discountedUnits: Metric; grossPromotionalValueToman: Metric; promotionDiscountToman: Metric; netPromotionalValueToman: Metric; attributedOrderValueToman: Metric; averageOrderValueToman: Metric; averageDiscountPerOrderToman: Metric; averageDiscountRatePercent: { value: string | null; previousValue: string | null } };
  series: PromotionOverviewData["series"];
  breakdowns: { products: Array<{ key: string; productId: string | null; name: string; units: string; orders: string; gross: string; discount: string; net: string }>; categories: Array<{ key: string; categoryId: string | null; name: string; units: string; orders: string; gross: string; discount: string; net: string }> };
  coupons: Array<{ couponCode: string; uses: string; customers: string; discount: string; sales: string; averageOrderValue: string; averageDiscount: string }>;
  customerConditions: Array<{ conditionType: string; orders: string; customers: string }>;
  usage: { definition: string; applicationCountAvailable: boolean };
};

export function PromotionDetailView({ data, rangeQuery, showOrdersLink }: { data: PromotionDetailData; rangeQuery: string; showOrdersLink: boolean }) {
  const showTable = (title: string, rows: Array<{ key: string; name: string; units: string; orders: string; gross: string; discount: string; net: string }>) => <section className="analytics-time-panel"><h2>{title}</h2>{rows.length ? <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>نام</th><th>واحدهای دارای تخفیف</th><th>سفارش‌ها</th><th>ارزش پیش از تخصیص</th><th>مبلغ تخفیف</th><th>ارزش پس از تخصیص</th></tr></thead><tbody>{rows.map((item) => <tr key={item.key}><td>{item.name}</td><td>{number(item.units)}</td><td>{number(item.orders)}</td><td>{toman(item.gross)}</td><td>{toman(item.discount)}</td><td>{toman(item.net)}</td></tr>)}</tbody></table></div> : <p className="analytics-table-empty">برای این تخفیف، تخصیص محصولی ثبت نشده است.</p>}</section>;
  return <div className="analytics-results promotion-analytics promotion-detail">
    <header className="analytics-heading"><div><p><Link href={`/admin/analytics?${rangeQuery}`}>بازگشت به آمار</Link></p><h1>{data.promotion.promotionName}</h1><p>{data.promotion.types.map(typeLabel).join("، ")} · {data.promotion.scopes.map(scopeLabel).join("، ")} · {data.promotion.activationModes.map(modeLabel).join(" / ")}</p></div><span className={`promotion-status ${data.promotion.status.toLowerCase()}`}>{statusLabel(data.promotion.status)}</span></header>
    {data.promotion.historicalNames.length > 1 && <p className="analytics-note">نام‌های ثبت‌شده در سفارش‌های تاریخی: {data.promotion.historicalNames.join("، ")}</p>}
    <div className="analytics-kpis promotion-detail-kpis">
      <article className="analytics-kpi"><span>استفاده</span><strong>{number(data.metrics.uses.value)}</strong><small>بازه قبل: {number(data.metrics.uses.previousValue)}</small></article>
      <article className="analytics-kpi"><span>سفارش‌ها</span><strong>{number(data.metrics.ordersWithPromotion.value)}</strong><small>بازه قبل: {number(data.metrics.ordersWithPromotion.previousValue)}</small></article>
      <article className="analytics-kpi"><span>مشتریان یکتا</span><strong>{number(data.metrics.uniqueCustomers.value)}</strong><small>جدید: {number(data.metrics.newCustomers.value)} · بازگشتی: {number(data.metrics.returningCustomers.value)}</small></article>
      <article className="analytics-kpi main"><span>مبلغ تخفیف اختصاص‌یافته</span><strong>{toman(data.metrics.promotionDiscountToman.value)}</strong><small>میانگین هر سفارش: {toman(data.metrics.averageDiscountPerOrderToman.value)}</small></article>
      <article className="analytics-kpi"><span>ارزش سفارش‌های مرتبط</span><strong>{toman(data.metrics.attributedOrderValueToman.value)}</strong><small>میانگین سفارش: {toman(data.metrics.averageOrderValueToman.value)}</small></article>
      <article className="analytics-kpi"><span>واحدهای دارای تخفیف</span><strong>{number(data.metrics.discountedUnits.value)}</strong><small>کدهای ثبت‌شده: {number(data.metrics.couponRedemptions.value)}</small></article>
      <article className="analytics-kpi"><span>ارزش پیش از تخصیص این تخفیف</span><strong>{toman(data.metrics.grossPromotionalValueToman.value)}</strong><small>ارزش پس از تخصیص: {toman(data.metrics.netPromotionalValueToman.value)}</small></article>
      <article className="analytics-kpi"><span>نسبت تخفیف به مبنای تخصیص</span><strong>{percentage(data.metrics.averageDiscountRatePercent.value)}</strong><small>بازه قبل: {percentage(data.metrics.averageDiscountRatePercent.previousValue)}</small></article>
    </div>
    <Trend data={data.series} granularity={data.granularity} timezone={data.timezone} title="روند این تخفیف" description="بازه زمانی بر اساس زمان تحویل سفارش" />
    <div className="promotion-detail-breakdowns">{showTable("محصولات دریافت‌کننده تخفیف", data.breakdowns.products)}{showTable("دسته‌بندی‌ها", data.breakdowns.categories)}</div>
    <div className="promotion-detail-breakdowns">
      <section className="analytics-time-panel"><h2>عملکرد کدها</h2>{data.coupons.length ? <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>کد</th><th>استفاده</th><th>مشتریان</th><th>تخفیف</th><th>میانگین تخفیف</th><th>ارزش سفارش مرتبط</th><th>میانگین سفارش</th></tr></thead><tbody>{data.coupons.map((coupon) => <tr key={coupon.couponCode}><td>{coupon.couponCode}</td><td>{number(coupon.uses)}</td><td>{number(coupon.customers)}</td><td>{toman(coupon.discount)}</td><td>{toman(coupon.averageDiscount)}</td><td>{toman(coupon.sales)}</td><td>{toman(coupon.averageOrderValue)}</td></tr>)}</tbody></table></div> : <p className="analytics-table-empty">این تخفیف با کد کوپن استفاده نشده است.</p>}</section>
      <section className="analytics-time-panel"><h2>شرایط مشتری ثبت‌شده هنگام سفارش</h2>{data.customerConditions.length ? <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>شرط</th><th>سفارش‌ها</th><th>مشتریان</th></tr></thead><tbody>{data.customerConditions.map((condition) => <tr key={condition.conditionType}><td>{({ FIRST_ORDER: "سفارش اول", ORDER_COUNT: "تعداد سفارش", TOTAL_SPENT: "مبلغ خرید", LAST_ORDER_AGE: "مدت از خرید قبلی", REGISTRATION_AGE: "قدمت حساب", CUSTOMER_SEGMENT: "گروه مشتریان" } as Record<string, string>)[condition.conditionType] ?? condition.conditionType}</td><td>{number(condition.orders)}</td><td>{number(condition.customers)}</td></tr>)}</tbody></table></div> : <p className="analytics-table-empty">شرط مشتری ثبت‌شده‌ای برای این بازه وجود ندارد.</p>}</section>
    </div>
    {showOrdersLink && <div className="promotion-orders-link"><p>جزئیات سفارش‌ها از فهرست سفارش‌های فعلی باز می‌شود.</p><Link href={`/admin/orders?promotionId=${data.promotion.promotionId}`}>مشاهده سفارش‌های استفاده‌کننده از این تخفیف</Link></div>}
    <p className="analytics-note">ارزش سفارش مرتبط، ارزش نهایی سفارش‌های تحویل‌شده است؛ این گزارش رابطه علّی میان تخفیف و فروش را اندازه‌گیری نمی‌کند. برای تخفیف‌های سطح سفارش، مبلغ مبنا برابر مبلغ کالاها پس از تخفیف محصول و پیش از تخفیف سفارش است. دریافت وجه حضوری و بازپرداخت در داده‌های فعلی ثبت نمی‌شوند.</p>
  </div>;
}
