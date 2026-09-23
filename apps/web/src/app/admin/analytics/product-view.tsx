"use client";

import { useEffect, useMemo, useState } from "react";
import { formatJalaliDate } from "../../jalali-date";

type Metric = { value: string; previousValue: string; change: string; changePercent: string | null };
type Point = { bucket: string; label: string; value: string };
type ProductRow = {
  key: string; productId: string | null; name: string; status: "active" | "unavailable" | "archived" | "deleted";
  revenueToman: Metric; quantitySold: Metric; ordersContainingProduct: Metric;
  revenueSharePercent: string; quantitySharePercent: string;
};
type CategoryRow = {
  key: string; categoryId: string | null; name: string; revenueToman: Metric; quantitySold: Metric;
  ordersContainingCategory: Metric; revenueSharePercent: string; quantitySharePercent: string;
};
type CategoryTrend = { key: string; categoryId: string | null; name: string; bucket: string; revenue: string; quantity: string; orders: string };

export type ProductAnalytics = {
  period: string; timezone: string; granularity: "hour" | "day" | "week" | "month" | "year";
  summary: { distinctProductsSold: string; topRevenueProduct: ProductRow | null; topQuantityProduct: ProductRow | null; activeProductsWithoutSales: string; topProductsRevenueSharePercent: string };
  rankings: { byRevenue: ProductRow[]; byQuantity: ProductRow[]; lowPerforming: ProductRow[]; growing: ProductRow[]; declining: ProductRow[] };
  contribution: ProductRow[]; categories: CategoryRow[]; categoryTrends: CategoryTrend[];
  zeroSaleProducts: Array<{ productId: string; name: string; categoryName: string }>;
  totals: { productRevenueToman: string; quantitySold: string };
};

export type ProductDetail = {
  timezone: string; granularity: ProductAnalytics["granularity"];
  product: { productId: string; name: string; status: ProductRow["status"] };
  metrics: { revenueToman: Metric; quantitySold: Metric; ordersContainingProduct: Metric; averageSellingPriceToman: string; revenueSharePercent: string };
  series: { revenueToman: { points: Point[] }; quantitySold: { points: Point[] } };
};

const fa = new Intl.NumberFormat("fa-IR");
const digits = "۰۱۲۳۴۵۶۷۸۹";
const number = (value: string) => fa.format(BigInt(value));
const toman = (value: string) => `${number(value)} تومان`;
const percentage = (value: string) => `${value.replace(/\d/g, (digit) => digits[Number(digit)]!)}٪`;
const change = (metric: Metric) => metric.changePercent === null ? "بدون مبنای مقایسه" : `${BigInt(metric.change) > BigInt(0) ? "+" : ""}${percentage(metric.changePercent)}`;
const statusLabel = (status: ProductRow["status"]) => status === "archived" ? "بایگانی‌شده" : status === "deleted" ? "حذف‌شده" : status === "unavailable" ? "ناموجود" : "فعال";

function SimpleTrend({ points, money, granularity, timezone, label }: { points: Point[]; money?: boolean; granularity: ProductAnalytics["granularity"]; timezone: string; label: string }) {
  const [active, setActive] = useState(0);
  const max = points.reduce((value, point) => BigInt(point.value) > value ? BigInt(point.value) : value, BigInt(0));
  const width = Math.max(560, points.length * 28 + 40);
  const step = points.length > 1 ? (width - 50) / (points.length - 1) : 0;
  const coordinates = points.map((point, index) => ({ x: 25 + step * index, y: 125 - Number(BigInt(point.value) * BigInt(90) / (max || BigInt(1))) }));
  const selected = points[Math.min(active, points.length - 1)];
  const pointLabel = (point: Point) => granularity === "hour" ? new Intl.DateTimeFormat("fa-IR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(point.bucket)) : formatJalaliDate(point.bucket.slice(0, 10));
  return <div className="product-mini-trend"><div><strong>{label}</strong>{selected && <span>{money ? toman(selected.value) : number(selected.value)}، {pointLabel(selected)}</span>}</div><div className="product-trend-scroll" tabIndex={0}><svg width={width} height="155" viewBox={`0 0 ${width} 155`} role="img" aria-label={label}><line x1="25" y1="125" x2={width - 25} y2="125" className="analytics-grid-line" /><polyline className="analytics-line" points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")} />{points.map((point, index) => <circle key={point.bucket} className={`analytics-dot ${active === index ? "active" : ""}`} cx={coordinates[index]!.x} cy={coordinates[index]!.y} r="4" tabIndex={0} onFocus={() => setActive(index)} onMouseEnter={() => setActive(index)} onClick={() => setActive(index)}><title>{pointLabel(point)}: {money ? toman(point.value) : number(point.value)}</title></circle>)}</svg></div></div>;
}

function RankingTable({ rows, onSelect }: { rows: ProductRow[]; onSelect: (id: string) => void }) {
  if (!rows.length) return <p className="analytics-table-empty">در این بازه محصول فروخته‌شده‌ای وجود ندارد.</p>;
  return <div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>رتبه</th><th>محصول</th><th>تعداد فروش</th><th>درآمد</th><th>سهم از فروش</th><th>تغییر درآمد</th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.key}><td>{fa.format(index + 1)}</td><td>{row.productId ? <button type="button" onClick={() => onSelect(row.productId!)}>{row.name}</button> : row.name}<small>{statusLabel(row.status)}</small></td><td>{number(row.quantitySold.value)}</td><td>{toman(row.revenueToman.value)}</td><td>{percentage(row.revenueSharePercent)}</td><td className={BigInt(row.revenueToman.change) < BigInt(0) ? "negative" : BigInt(row.revenueToman.change) > BigInt(0) ? "positive" : ""}>{change(row.revenueToman)}</td></tr>)}</tbody></table></div>;
}

export function ProductView({ data, detail, detailBusy, selectedProductId, onSelectProduct }: { data: ProductAnalytics; detail: ProductDetail | null; detailBusy: boolean; selectedProductId: string; onSelectProduct: (id: string) => void }) {
  const [ranking, setRanking] = useState<"revenue" | "quantity" | "low">("revenue");
  const [categoryKey, setCategoryKey] = useState(data.categoryTrends[0]?.key ?? "");
  const productOptions = useMemo(() => [...new Map([...data.rankings.byRevenue.filter((row) => row.productId).map((row) => [row.productId!, { productId: row.productId!, name: row.name }] as const), ...data.zeroSaleProducts.map((row) => [row.productId, { productId: row.productId, name: row.name }] as const)]).values()], [data.rankings.byRevenue, data.zeroSaleProducts]);
  const categoryNames = useMemo(() => [...new Map(data.categoryTrends.map((row) => [row.key, row.name])).entries()], [data.categoryTrends]);
  const categoryPoints = data.categoryTrends.filter((row) => row.key === categoryKey);
  const rankingRows = ranking === "revenue" ? data.rankings.byRevenue : ranking === "quantity" ? data.rankings.byQuantity : data.rankings.lowPerforming;
  useEffect(() => { if (!categoryNames.some(([key]) => key === categoryKey)) setCategoryKey(categoryNames[0]?.[0] ?? ""); }, [categoryKey, categoryNames]);
  if (!data.rankings.byRevenue.length && !data.zeroSaleProducts.length) return <div className="analytics-empty"><strong>در این بازه محصولی فروخته نشده است.</strong><p>پس از ثبت سفارش تحویل‌شده، عملکرد محصولات و دسته‌بندی‌ها اینجا نمایش داده می‌شود.</p></div>;
  return <div className="product-analytics">
    <p className="analytics-time-intro">درآمد محصول از مبلغ واقعی ردیف سفارش و تعداد فروش از جمع تعداد هر ردیف محاسبه می‌شود.</p>
    <div className="analytics-kpis product-kpis"><article className="analytics-kpi main"><span>محصول اول از نظر درآمد</span><strong>{data.summary.topRevenueProduct?.name ?? "بدون فروش"}</strong><small>{data.summary.topRevenueProduct ? toman(data.summary.topRevenueProduct.revenueToman.value) : ""}</small></article><article className="analytics-kpi"><span>محصول اول از نظر تعداد</span><strong>{data.summary.topQuantityProduct?.name ?? "بدون فروش"}</strong><small>{data.summary.topQuantityProduct ? `${number(data.summary.topQuantityProduct.quantitySold.value)} واحد` : ""}</small></article><article className="analytics-kpi"><span>محصولات فروخته‌شده</span><strong>{number(data.summary.distinctProductsSold)}</strong><small>{number(data.totals.quantitySold)} واحد در مجموع</small></article><article className="analytics-kpi"><span>محصول فعال بدون فروش</span><strong>{number(data.summary.activeProductsWithoutSales)}</strong><small>در بازه انتخاب‌شده</small></article></div>
    <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>رتبه‌بندی محصولات</h2><p>جدول بر اساس معیار انتخابی مرتب شده است.</p></div><div className="analytics-metric-switch product-ranking-switch" role="group" aria-label="معیار رتبه‌بندی"><button type="button" aria-pressed={ranking === "revenue"} onClick={() => setRanking("revenue")}>درآمد</button><button type="button" aria-pressed={ranking === "quantity"} onClick={() => setRanking("quantity")}>تعداد</button><button type="button" aria-pressed={ranking === "low"} onClick={() => setRanking("low")}>کم‌فروش</button></div></div><RankingTable rows={rankingRows} onSelect={onSelectProduct} /></section>
    <div className="product-two-column"><section className="analytics-time-panel"><h2>سهم درآمد محصولات</h2><p>پنج محصول اول و مجموع سایر محصولات</p><div className="product-share-list">{data.contribution.map((row) => <div key={row.key}><span>{row.name}</span><strong>{percentage(row.revenueSharePercent)}</strong><i style={{ width: `${Math.min(100, Number(row.revenueSharePercent))}%` }} /></div>)}</div></section><section className="analytics-time-panel"><h2>عملکرد دسته‌بندی‌ها</h2><p>درآمد و تعداد بر اساس دسته‌بندی هنگام فروش</p><div className="analytics-table-scroll" tabIndex={0}><table className="analytics-table"><thead><tr><th>دسته‌بندی</th><th>درآمد</th><th>تعداد</th><th>سهم</th></tr></thead><tbody>{data.categories.map((category) => <tr key={category.key}><td>{category.name}</td><td>{toman(category.revenueToman.value)}</td><td>{number(category.quantitySold.value)}</td><td>{percentage(category.revenueSharePercent)}</td></tr>)}</tbody></table></div></section></div>
    {categoryNames.length > 0 && <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>روند دسته‌بندی‌های برتر</h2><p>تا پنج دسته‌بندی اول بر اساس درآمد بازه</p></div><label className="analytics-inline-select">دسته‌بندی<select value={categoryKey} onChange={(event) => setCategoryKey(event.target.value)}>{categoryNames.map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label></div><SimpleTrend label="روند درآمد دسته‌بندی" money granularity={data.granularity} timezone={data.timezone} points={categoryPoints.map((point) => ({ bucket: point.bucket, label: point.bucket, value: point.revenue }))} /></section>}
    <section className="analytics-time-panel"><div className="analytics-time-header"><div><h2>جزئیات و روند محصول</h2><p>درآمد، تعداد و سفارش‌های دارای محصول در بازه فعلی و قبلی</p></div>{productOptions.length > 0 && <label className="analytics-inline-select">محصول<select value={selectedProductId} onChange={(event) => onSelectProduct(event.target.value)}>{productOptions.map((product) => <option key={product.productId} value={product.productId}>{product.name}</option>)}</select></label>}</div>{detailBusy ? <div className="product-detail-loading" role="status">در حال دریافت جزئیات…</div> : detail ? <><div className="product-detail-metrics"><div><span>درآمد</span><strong>{toman(detail.metrics.revenueToman.value)}</strong><small>{change(detail.metrics.revenueToman)}</small></div><div><span>تعداد فروش</span><strong>{number(detail.metrics.quantitySold.value)}</strong><small>{change(detail.metrics.quantitySold)}</small></div><div><span>سفارش دارای محصول</span><strong>{number(detail.metrics.ordersContainingProduct.value)}</strong><small>{change(detail.metrics.ordersContainingProduct)}</small></div><div><span>میانگین قیمت فروش</span><strong>{toman(detail.metrics.averageSellingPriceToman)}</strong><small>{percentage(detail.metrics.revenueSharePercent)} از درآمد محصولات</small></div></div><div className="product-two-column"><SimpleTrend label="روند درآمد محصول" money points={detail.series.revenueToman.points} granularity={detail.granularity} timezone={detail.timezone} /><SimpleTrend label="روند تعداد فروش" points={detail.series.quantitySold.points} granularity={detail.granularity} timezone={detail.timezone} /></div></> : <p className="analytics-table-empty">برای این محصول داده‌ای در دسترس نیست.</p>}</section>
    <div className="product-two-column"><section className="analytics-time-panel"><h2>بیشترین رشد درآمد</h2><p>مرتب‌شده بر اساس افزایش مطلق درآمد، نه درصدهای کوچک و گمراه‌کننده</p><div className="product-change-list">{data.rankings.growing.slice(0, 5).map((row) => <div key={row.key}><span>{row.name}</span><strong className="positive">+{toman(row.revenueToman.change)}</strong><small>{change(row.revenueToman)}</small></div>)}{!data.rankings.growing.length && <span>رشد درآمدی ثبت نشده است.</span>}</div></section><section className="analytics-time-panel"><h2>بیشترین افت درآمد</h2><p>کاهش مطلق درآمد همراه با درصد تغییر</p><div className="product-change-list">{data.rankings.declining.slice(0, 5).map((row) => <div key={row.key}><span>{row.name}</span><strong className="negative">{toman(row.revenueToman.change)}</strong><small>{change(row.revenueToman)}</small></div>)}{!data.rankings.declining.length && <span>افت درآمدی ثبت نشده است.</span>}</div></section></div>
    {data.zeroSaleProducts.length > 0 && <section className="analytics-time-panel"><h2>محصولات فعال بدون فروش</h2><p>این فهرست از محصولات کم‌فروش دارای فروش جداست.</p><div className="zero-sale-list">{data.zeroSaleProducts.map((product) => <button type="button" key={product.productId} onClick={() => onSelectProduct(product.productId)}><span>{product.name}</span><small>{product.categoryName}</small><strong>۰ فروش</strong></button>)}</div></section>}
  </div>;
}
