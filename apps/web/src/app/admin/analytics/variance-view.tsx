"use client";

import { useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Location = { id: string; name: string; isDefault: boolean; isActive: boolean };
type Count = { id: string; locationId: string; locationName: string; completedAt: string; itemCount: number };
type VarianceRow = {
  itemId: string; itemName: string; baseUnit: string; openingPhysicalQuantity: string | null; trustedInbound: string | null;
  trustedOutbound: string | null; closingPhysicalQuantity: string | null; actualDepletion: string | null;
  theoreticalSaleUsage: string | null; knownWaste: string | null; otherExplainedConsumption: string | null;
  unexplainedVariance: string | null; variancePercent: string | null; varianceCostStatus: "UNAVAILABLE" | "AVAILABLE";
  varianceCostToman: string | null; calculationStatus: "CALCULABLE" | "CALCULABLE_WITH_WARNINGS" | "NOT_CALCULABLE";
  dataQualityFlags: string[]; manualAdjustmentCount: number; manualAdjustmentQuantity: string;
};
type Movement = { type: string; quantityBase: string; reason: string | null; classification: string; sourceValid: boolean; sourceLabel: string | null; sourceReference: string | null; recordedAt: string; effectiveAt: string };
type VarianceDetail = VarianceRow & { movements: Movement[]; closingCountAdjustment: { type: string; quantityBase: string; recordedAt: string } | null };
type Report = {
  period: { locationId: string; locationName: string; openingCount: Count; closingCount: Count; boundary: string };
  items: VarianceRow[]; page: number; limit: number; total: number;
  summary: { itemsAnalyzed: number; calculableItems: number; itemsWithWarnings: number; notCalculableItems: number; positiveVarianceItems: number; negativeVarianceItems: number; zeroVarianceItems: number; itemsWithoutHistoricalVarianceCost: number };
  coverage: { orderItemsInCoverageWindow: number; orderItemsWithInventoryConsumption: number; orderCoveragePercent: string | null };
};

const fa = new Intl.NumberFormat("fa-IR");
const units: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const faDigits = "۰۱۲۳۴۵۶۷۸۹";
const flags: Record<string, string> = {
  MISSING_PHYSICAL_COUNT: "برای این قلم، شمارش فیزیکی در هر دو مرز دوره ثبت نشده است.",
  MANUAL_ADJUSTMENTS: "اصلاح دستی موجودی در دوره ثبت شده است.",
  OPENING_BALANCE_DURING_PERIOD: "ثبت موجودی اولیه در میانه دوره رخ داده است.",
  COUNT_RECONCILIATION_DURING_PERIOD: "اصلاح ناشی از شمارش دیگری در دوره ثبت شده و در مصرف دوباره شمرده نشده است.",
  INVALID_MOVEMENT_SOURCE: "یک گردش موجودی، ارجاع منبع کامل یا معتبر ندارد.",
  ORDER_LINES_WITHOUT_INVENTORY_CONSUMPTION: "برخی اقلام سفارش این بازه، گردش مصرف موجودی ندارند.",
};
function decimal(value: string) {
  const [signedInteger, fraction] = value.split(".");
  const negative = signedInteger?.startsWith("-") ?? false;
  const integer = negative ? signedInteger!.slice(1) : signedInteger!;
  const whole = BigInt(integer || "0").toLocaleString("fa-IR");
  const digits = (fraction ?? "").replace(/0+$/, "").replace(/\d/g, (digit) => faDigits[Number(digit)]!);
  return `${negative ? "−" : ""}${whole}${digits ? `٫${digits}` : ""}`;
}
const quantity = (value: string | null, unit: string) => value === null ? "—" : `${decimal(value)} ${units[unit] ?? unit}`;
const percent = (value: string | null) => value === null ? "—" : `${!value.startsWith("-") && !/^0(?:\.0+)?$/.test(value) ? "+" : ""}${decimal(value)}٪`;
const date = (value: string, timezone: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone: timezone }).format(new Date(value));
const countLabel = (count: Count, timezone: string) => `${date(count.completedAt, timezone)} · ${fa.format(count.itemCount)} قلم`;
const queryFor = (locationId: string, openingCountId: string, closingCountId: string) => new URLSearchParams({ locationId, openingCountId, closingCountId });

function errorState(reason: unknown) {
  const error = reason as Error & { code?: string };
  return { message: error.message || "دریافت گزارش ممکن نشد.", unavailable: error.code === "FEATURE_UNAVAILABLE" };
}

export function InventoryVarianceView({ timezone }: { timezone: string }) {
  const { api } = useAdminSession();
  const [locations, setLocations] = useState<Location[]>([]);
  const [counts, setCounts] = useState<Count[]>([]);
  const [locationId, setLocationId] = useState("");
  const [openingCountId, setOpeningCountId] = useState("");
  const [closingCountId, setClosingCountId] = useState("");
  const [direction, setDirection] = useState("ALL");
  const [sortBy, setSortBy] = useState("variance");
  const [sortDirection, setSortDirection] = useState("DESC");
  const [page, setPage] = useState(1);
  const [report, setReport] = useState<Report | null>(null);
  const [detailId, setDetailId] = useState("");
  const [detail, setDetail] = useState<VarianceDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [unavailable, setUnavailable] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoadingOptions(true); setError(""); setUnavailable(false);
    api<{ locations: Location[]; counts: Count[] }>("/tenant/analytics/inventory/variance/counts", { signal: controller.signal }).then(({ locations: nextLocations, counts: nextCounts }) => {
      setLocations(nextLocations); setCounts(nextCounts);
      setLocationId((current) => current && nextLocations.some((location) => location.id === current) ? current : nextLocations.find((location) => location.isDefault)?.id ?? nextLocations[0]?.id ?? "");
    }).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const state = errorState(reason); setError(state.message); setUnavailable(state.unavailable);
    }).finally(() => { if (!controller.signal.aborted) setLoadingOptions(false); });
    return () => controller.abort();
  }, [api]);

  useEffect(() => {
    const available = counts.filter((count) => count.locationId === locationId);
    setOpeningCountId((current) => available.some((count) => count.id === current) ? current : available[1]?.id ?? "");
    setClosingCountId((current) => available.some((count) => count.id === current) ? current : available[0]?.id ?? "");
    setPage(1); setDetailId(""); setDetail(null);
  }, [counts, locationId]);

  useEffect(() => {
    if (!locationId || !openingCountId || !closingCountId) { setReport(null); return; }
    const controller = new AbortController();
    const params = queryFor(locationId, openingCountId, closingCountId);
    params.set("page", String(page)); params.set("limit", "50"); params.set("sortBy", sortBy);
    params.set("sortDirection", sortDirection); params.set("varianceDirection", direction);
    setLoading(true); setError(""); setUnavailable(false); setDetailId(""); setDetail(null);
    api<Report>(`/tenant/analytics/inventory/variance?${params}`, { signal: controller.signal }).then(setReport).catch((reason: unknown) => {
      if (controller.signal.aborted) return;
      const state = errorState(reason); setError(state.message); setUnavailable(state.unavailable); setReport(null);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [api, direction, locationId, openingCountId, closingCountId, page, reload, sortBy, sortDirection]);

  useEffect(() => {
    if (!detailId || !locationId || !openingCountId || !closingCountId) { setDetailLoading(false); setDetailError(""); return; }
    const controller = new AbortController();
    const params = queryFor(locationId, openingCountId, closingCountId);
    setDetailLoading(true); setDetailError("");
    api<VarianceDetail>(`/tenant/analytics/inventory/variance/items/${detailId}?${params}`, { signal: controller.signal })
      .then(setDetail).catch((reason: unknown) => { if (!controller.signal.aborted) { setDetail(null); setDetailError(errorState(reason).message); } })
      .finally(() => { if (!controller.signal.aborted) setDetailLoading(false); });
    return () => controller.abort();
  }, [api, detailId, locationId, openingCountId, closingCountId]);

  const locationCounts = counts.filter((count) => count.locationId === locationId);
  return <div className="variance-view" dir="rtl">
    <div className="variance-intro"><h2>مصرف واقعی و تئوری</h2><p>مصرف واقعی از شمارش فیزیکی ابتدا و انتهای دوره و ورودی و خروجی معتبر محاسبه می‌شود. مصرف تئوری از گردش‌های فروش ثبت‌شده با نسخه رسپی زمان فروش به دست می‌آید.</p><p>اختلاف توضیح‌داده‌نشده به‌تنهایی علت را مشخص نمی‌کند؛ فروش خارج از یوکافه، خطای شمارش، رسپی یا ثبت ناقص می‌تواند در آن اثر بگذارد.</p></div>
    <div className="variance-filters">
      <label>محل نگهداری<select value={locationId} onChange={(event) => setLocationId(event.target.value)} disabled={loadingOptions}><option value="">انتخاب محل</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}{!location.isActive ? " · غیرفعال" : ""}</option>)}</select></label>
      <label>شمارش ابتدای دوره<select value={openingCountId} onChange={(event) => { setOpeningCountId(event.target.value); setPage(1); }} disabled={!locationCounts.length}><option value="">انتخاب شمارش</option>{locationCounts.map((count) => <option key={count.id} value={count.id}>{countLabel(count, timezone)}</option>)}</select></label>
      <label>شمارش پایان دوره<select value={closingCountId} onChange={(event) => { setClosingCountId(event.target.value); setPage(1); }} disabled={!locationCounts.length}><option value="">انتخاب شمارش</option>{locationCounts.map((count) => <option key={count.id} value={count.id}>{countLabel(count, timezone)}</option>)}</select></label>
      <label>جهت اختلاف<select value={direction} onChange={(event) => { setDirection(event.target.value); setPage(1); }}><option value="ALL">همه</option><option value="POSITIVE">مصرف بیشتر از مقدار توضیح‌داده‌شده</option><option value="NEGATIVE">مصرف کمتر از مقدار تئوری</option><option value="ZERO">بدون اختلاف</option></select></label>
      <label>مرتب‌سازی<select value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}><option value="variance">مقدار اختلاف</option><option value="variancePercent">درصد اختلاف</option><option value="itemName">نام قلم</option></select></label>
      <label>ترتیب<select value={sortDirection} onChange={(event) => { setSortDirection(event.target.value); setPage(1); }}><option value="DESC">نزولی</option><option value="ASC">صعودی</option></select></label>
    </div>
    {loadingOptions ? <div className="analytics-loading" role="status"><span className="admin-spinner" />در حال دریافت شمارش‌ها…</div>
      : unavailable ? <div className="analytics-state"><h3>این گزارش به فعال بودن موجودی و آمار نیاز دارد</h3><p>{error} هر دو قابلیت موجودی و آمار باید در اشتراک فعال باشند.</p></div>
        : error ? <div className="analytics-state" role="alert"><h3>گزارش دریافت نشد</h3><p>{error}</p><button type="button" onClick={() => setReload((value) => value + 1)}>تلاش دوباره</button></div>
          : !locationCounts.length ? <div className="analytics-empty"><strong>برای این محل شمارش تکمیل‌شده‌ای وجود ندارد.</strong><p>برای محاسبه اختلاف، دست‌کم دو شمارش فیزیکی تکمیل‌شده ثبت کنید.</p></div>
            : locationCounts.length < 2 ? <div className="analytics-empty"><strong>برای محاسبه، دو شمارش فیزیکی لازم است.</strong><p>با یک شمارش نمی‌توان مصرف واقعی را بدون برآورد ساختگی تعیین کرد.</p></div>
              : loading && !report ? <div className="analytics-loading" role="status"><span className="admin-spinner" />در حال محاسبه گزارش…</div>
                : report && <div className="analytics-results" aria-busy={loading}>
                  <div className="variance-summary">
                    <article><span>قلم‌های قابل محاسبه</span><strong>{fa.format(report.summary.calculableItems)}</strong></article>
                    <article><span>نیازمند بررسی</span><strong>{fa.format(report.summary.itemsWithWarnings + report.summary.notCalculableItems)}</strong></article>
                    <article><span>اختلاف مثبت / منفی</span><strong>{fa.format(report.summary.positiveVarianceItems)} / {fa.format(report.summary.negativeVarianceItems)}</strong></article>
                    <article><span>هزینه تاریخی اختلاف</span><strong>در دسترس نیست</strong></article>
                  </div>
                  <p className="variance-period-note">{report.period.locationName} · {countLabel(report.period.openingCount, timezone)} تا {countLabel(report.period.closingCount, timezone)}. برای هر قلم، زمان ثبت همان قلم در شمارش مرز دوره است.</p>
                  <p className="variance-coverage">پوشش گردش مصرف سفارش: {report.coverage.orderCoveragePercent === null ? "بدون مبنای محاسبه" : `${fa.format(Number(report.coverage.orderCoveragePercent))}٪`} ({fa.format(report.coverage.orderItemsWithInventoryConsumption)} از {fa.format(report.coverage.orderItemsInCoverageWindow)} قلم سفارش). این پوشش بر اساس زمان ایجاد سفارش محاسبه شده و زمان پذیرش فروش در تاریخچه سفارش نگهداری نمی‌شود.</p>
                  <div className="analytics-table-scroll variance-table-scroll" tabIndex={0}><table className="analytics-table variance-table"><thead><tr><th>قلم</th><th>ابتدای دوره</th><th>ورودی معتبر</th><th>پایان دوره</th><th>مصرف واقعی</th><th>مصرف تئوری</th><th>ضایعات ثبت‌شده</th><th>اختلاف توضیح‌داده‌نشده</th><th>درصد</th><th>هزینه تاریخی</th><th>وضعیت</th></tr></thead><tbody>
                    {report.items.map((row) => <tr key={row.itemId} className={detailId === row.itemId ? "variance-selected" : ""}>
                      <td><button className="variance-row-button" type="button" onClick={() => setDetailId((current) => current === row.itemId ? "" : row.itemId)}>{row.itemName}</button><small>{units[row.baseUnit] ?? row.baseUnit}</small></td>
                      <td>{quantity(row.openingPhysicalQuantity, row.baseUnit)}</td><td>{quantity(row.trustedInbound, row.baseUnit)}{row.trustedOutbound && row.trustedOutbound !== "0" ? <small>خروج معتبر: {quantity(row.trustedOutbound, row.baseUnit)}</small> : null}</td>
                      <td>{quantity(row.closingPhysicalQuantity, row.baseUnit)}</td><td>{quantity(row.actualDepletion, row.baseUnit)}</td><td>{quantity(row.theoreticalSaleUsage, row.baseUnit)}</td><td>{quantity(row.knownWaste, row.baseUnit)}</td>
                      <td className={row.unexplainedVariance?.startsWith("-") ? "variance-negative" : "variance-positive"}>{quantity(row.unexplainedVariance, row.baseUnit)}</td><td>{percent(row.variancePercent)}</td><td>نامشخص</td>
                      <td><span className={`variance-status ${row.calculationStatus.toLowerCase()}`}>{row.calculationStatus === "NOT_CALCULABLE" ? "قابل محاسبه نیست" : row.calculationStatus === "CALCULABLE_WITH_WARNINGS" ? "با هشدار" : "قابل محاسبه"}</span></td>
                    </tr>)}
                  </tbody></table></div>
                  {!report.items.length && <div className="analytics-empty"><strong>قلمی با این فیلتر وجود ندارد.</strong></div>}
                  {report.total > report.limit && <div className="variance-pagination"><button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>صفحه قبل</button><span>{fa.format(report.page)} از {fa.format(Math.max(1, Math.ceil(report.total / report.limit)))}</span><button type="button" disabled={page * report.limit >= report.total || loading} onClick={() => setPage(page + 1)}>صفحه بعد</button></div>}
                  {detailId && <VarianceBreakdown row={report.items.find((row) => row.itemId === detailId)} detail={detail} busy={detailLoading} error={detailError} timezone={timezone} />}
                </div>}
  </div>;
}

function VarianceBreakdown({ row, detail, busy, error, timezone }: { row?: VarianceRow; detail: VarianceDetail | null; busy: boolean; error: string; timezone: string }) {
  if (!row) return null;
  return <section className="variance-breakdown" aria-label={`جزئیات اختلاف ${row.itemName}`}>
    <header><div><h3>{row.itemName} · محاسبه دوره</h3><p>ورودی و خروجی معتبر از مصرف فروش و ضایعات جدا نگه داشته می‌شوند.</p></div></header>
    <dl><div><dt>موجودی فیزیکی ابتدا</dt><dd>{quantity(row.openingPhysicalQuantity, row.baseUnit)}</dd></div><div><dt>ورودی معتبر</dt><dd>{quantity(row.trustedInbound, row.baseUnit)}</dd></div><div><dt>خروجی معتبر</dt><dd>{quantity(row.trustedOutbound, row.baseUnit)}</dd></div><div><dt>موجودی فیزیکی پایان</dt><dd>{quantity(row.closingPhysicalQuantity, row.baseUnit)}</dd></div><div><dt>مصرف واقعی</dt><dd>{quantity(row.actualDepletion, row.baseUnit)}</dd></div><div><dt>مصرف فروش ثبت‌شده</dt><dd>{quantity(row.theoreticalSaleUsage, row.baseUnit)}</dd></div><div><dt>ضایعات خالص</dt><dd>{quantity(row.knownWaste, row.baseUnit)}</dd></div><div><dt>سایر مصرف توضیح‌داده‌شده</dt><dd>{quantity(row.otherExplainedConsumption, row.baseUnit)}</dd></div><div><dt>مصرف توضیح‌داده‌نشده</dt><dd>{quantity(row.unexplainedVariance, row.baseUnit)} · {percent(row.variancePercent)}</dd></div></dl>
    {row.dataQualityFlags.length > 0 && <div className="variance-warnings"><strong>کیفیت داده و محدودیت‌ها</strong><ul>{row.dataQualityFlags.map((flag) => <li key={flag}>{flags[flag] ?? flag}</li>)}</ul></div>}
    <p className="variance-cost-note">ارزش مالی تاریخی در دسترس نیست؛ موجودی‌ها فقط میانگین بهای فعلی را نگه می‌دارند و گزارش از قیمت امروز به‌عنوان بهای تاریخی استفاده نمی‌کند.</p>
    {busy ? <p className="analytics-loading" role="status">در حال دریافت گردش‌های منبع…</p> : error ? <p className="variance-cost-note" role="alert">{error}</p> : detail ? <>
      <h4>گردش‌های داخل بازه محاسبه</h4>
      <ul className="variance-movements">{detail.movements.map((movement, index) => <li key={`${movement.type}:${movement.effectiveAt}:${index}`}><span><strong>{movement.sourceReference ?? movement.reason ?? movement.sourceLabel ?? movement.type}</strong><small>{date(movement.effectiveAt, timezone)} · {movement.classification}{movement.recordedAt !== movement.effectiveAt ? ` · ثبت ${date(movement.recordedAt, timezone)}` : ""}{!movement.sourceValid ? " · منبع نامعتبر؛ در محاسبه منظور نشده" : ""}</small></span><b dir="ltr">{quantity(movement.quantityBase, row.baseUnit)}</b></li>)}{!detail.movements.length && <li>گردشی در بازه شمارش ثبت نشده است.</li>}</ul>
      {detail.closingCountAdjustment && <p className="variance-cost-note">اصلاح شمارش پایانی {quantity(detail.closingCountAdjustment.quantityBase, row.baseUnit)} بعد از زمان شمارش قلم ثبت شده است؛ در مصرف واقعی دوباره شمرده نشده است.</p>}
    </> : null}
    <p className="variance-cost-note">گردش‌های فروش با نسخه رسپی زمان فروش استفاده می‌شوند. فروش ثبت‌نشده خارج از یوکافه در مصرف تئوری وارد نمی‌شود و ممکن است در اختلاف توضیح‌داده‌نشده دیده شود.</p>
  </section>;
}
