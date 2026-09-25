"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../../admin-session";

type Page<T> = { items: T[]; page: number; limit: number; total: number };
type Location = { id: string; name: string; isDefault: boolean; isActive: boolean };
type StockRow = {
  itemId: string; name: string; dimension: "WEIGHT" | "VOLUME" | "COUNT"; baseUnit: string; unit: string;
  locationId: string; locationName: string; quantity: string; minimumQuantity: string | null; parQuantity: string | null;
  onOrderQuantity: string; projectedQuantity: string; stockStatus: string | null; replenishmentGap: string | null;
  suggestedPurchaseQuantity: string | null; suggestedPurchaseUnit: string; minimumOrderQuantity: string | null;
  preferredSupplier: { id: string; name: string; isActive: boolean } | null; latestNormalizedPriceTomanPerBaseUnit: string | null;
  previousNormalizedPriceTomanPerBaseUnit: string | null; priceChangePercent: string | null; lastPurchase: { quantity: string; unit: string; purchaseUnits: string; normalizedPriceTomanPerBaseUnit: string; receiptNumber: string; receivedAt: string } | null;
  estimatedPurchaseCostToman: string | null; hasDraftPurchaseOrder: boolean; expiredBatchQuantity: string; expiringSoonBatchQuantity: string; dataWarnings: string[];
  estimatedUnitPriceToman: string | null;
};
type SupplierPrice = {
  supplierId: string; supplierName: string; supplierIsActive: boolean; preferredPurchaseUnit: string | null; minimumOrderQuantity: string | null; preferred: boolean;
  latestQuantity: string | null; latestUnit: string | null; latestPurchaseUnits: string | null; latestReceiptNumber: string | null; latestPurchaseDate: string | null;
  latestNormalizedPriceTomanPerBaseUnit: string | null; previousNormalizedPriceTomanPerBaseUnit: string | null; previousPurchaseDate: string | null; priceChangePercent: string | null;
};
type HistoryRow = { receiptNumber: string; receivedAt: string; quantity: string; unit: string; purchaseUnits: string; totalCostToman: string; normalizedPriceTomanPerBaseUnit: string };
const unitName: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const statusName: Record<string, string> = { NEGATIVE: "موجودی منفی", OUT_OF_STOCK: "ناموجود", LOW_STOCK: "کمتر از حداقل", BELOW_PAR: "کمتر از هدف", OK: "مناسب" };
const warningName: Record<string, string> = {
  TARGET_NOT_CONFIGURED: "موجودی هدف (PAR) تنظیم نشده است.", TARGET_COVERED: "سفارش‌های باز هدف را پوشش می‌دهند.", EXPIRED_STOCK_EXCLUDED: "موجودی بچ‌های منقضی‌شده از مقدار قابل‌تأمین کسر شده است.",
  BATCH_EXPIRING_SOON: "موجودی از بچ‌هایی دارد که به‌زودی منقضی می‌شوند.", DRAFT_PURCHASE_ORDER_EXISTS: "برای این کالا پیش‌نویس سفارش خرید وجود دارد.", NO_PREFERRED_SUPPLIER: "تأمین‌کننده ترجیحی تنظیم نشده است.",
  PREFERRED_SUPPLIER_INACTIVE: "تأمین‌کننده ترجیحی غیرفعال است.", NO_RECORDED_PRICE: "قیمت خرید ثبت‌شده‌ای برای تأمین‌کننده ترجیحی وجود ندارد.", SUPPLIER_MINIMUM_APPLIED: "حداقل مقدار سفارش تأمین‌کننده اعمال شده است.",
};
const digits = (value: string | number) => String(value).replace(/\B(?=(\d{3})+(?!\d))/g, "٬").replace(/\./g, "٫").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
const money = (value: string) => value.replace(/\B(?=(\d{3})+(?!\d))/g, "٬").replace(/\./g, "٫").replace(/\d/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]!);
const date = (value: string | null) => value ? new Date(value).toLocaleDateString("fa-IR") : "—";
const unitOptions = (item: StockRow) => item.dimension === "WEIGHT" ? ["g", "kg"] : item.dimension === "VOLUME" ? ["ml", "l"] : [item.baseUnit];

export default function ReplenishmentAssistant({ canManage, onDraftCreated }: { canManage: boolean; onDraftCreated: (id: string) => void }) {
  const { api } = useAdminSession();
  const [rows, setRows] = useState<Page<StockRow>>({ items: [], page: 1, limit: 50, total: 0 });
  const [locations, setLocations] = useState<Location[]>([]);
  const [page, setPage] = useState(1);
  const [locationId, setLocationId] = useState("");
  const [stockStatus, setStockStatus] = useState("");
  const [search, setSearch] = useState("");
  const [selectedItems, setSelectedItems] = useState<Record<string, StockRow>>({});
  const [comparison, setComparison] = useState<{ item: StockRow; suppliers: SupplierPrice[] } | null>(null);
  const [supplierId, setSupplierId] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [minimumOrderQuantity, setMinimumOrderQuantity] = useState("");
  const [history, setHistory] = useState<{ supplierId: string; rows: HistoryRow[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (locationId) params.set("locationId", locationId);
      if (stockStatus) params.set("stockStatus", stockStatus);
      if (search.trim()) params.set("search", search.trim());
      const [result, places] = await Promise.all([
        api<Page<StockRow>>(`/tenant/inventory/replenishment?${params}`),
        locations.length ? Promise.resolve(locations) : api<Location[]>("/tenant/inventory/locations"),
      ]);
      setRows(result); setLocations(places);
      setSelectedItems((current) => {
        const next = { ...current };
        for (const row of result.items) {
          const key = `${row.itemId}:${row.locationId}`;
          if (next[key] && row.preferredSupplier?.isActive && row.estimatedPurchaseCostToman !== null && row.replenishmentGap !== null && row.replenishmentGap !== "0") next[key] = row;
          else delete next[key];
        }
        return next;
      });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "پیشنهادهای تأمین موجودی دریافت نشد."); }
    finally { setLoading(false); }
  }, [api, locationId, locations, page, search, stockStatus]);
  useEffect(() => { void load(); }, [load]);

  const selectedRows = useMemo(() => Object.values(selectedItems), [selectedItems]);

  async function openComparison(row: StockRow) {
    setHistory(null); setError(""); setComparison({ item: row, suppliers: [] });
    try {
      const result = await api<{ items: SupplierPrice[] }>(`/tenant/inventory/items/${row.itemId}/supplier-prices?limit=100&page=1`);
      setComparison({ item: row, suppliers: result.items });
      const preferred = result.items.find((supplier) => supplier.preferred);
      const firstActive = result.items.find((supplier) => supplier.supplierIsActive);
      const initial = preferred ?? firstActive;
      setSupplierId(initial?.supplierId ?? "");
      setPurchaseUnit(initial?.preferredPurchaseUnit ?? initial?.latestUnit ?? row.unit);
      setMinimumOrderQuantity(initial?.minimumOrderQuantity ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "مقایسه قیمت دریافت نشد."); setComparison(null); }
  }

  async function savePreference() {
    if (!comparison || !supplierId) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/inventory/items/${comparison.item.itemId}/suppliers/${supplierId}/preference`, { method: "PUT", body: JSON.stringify({ isPreferred: true, purchaseUnit, minimumOrderQuantity: minimumOrderQuantity.trim() || null }) });
      setNotice("تأمین‌کننده ترجیحی ذخیره شد."); setComparison(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تنظیم تأمین‌کننده ذخیره نشد."); }
    finally { setBusy(false); }
  }

  async function clearPreference() {
    if (!comparison?.item.preferredSupplier) return;
    setBusy(true); setError("");
    try {
      await api(`/tenant/inventory/items/${comparison.item.itemId}/suppliers/${comparison.item.preferredSupplier.id}/preference`, { method: "PUT", body: JSON.stringify({ isPreferred: false }) });
      setNotice("تأمین‌کننده ترجیحی پاک شد."); setComparison(null); await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "تنظیم ذخیره نشد."); }
    finally { setBusy(false); }
  }

  async function showHistory(id: string) {
    if (!comparison) return;
    setError("");
    try {
      const result = await api<Page<HistoryRow>>(`/tenant/inventory/items/${comparison.item.itemId}/supplier-price-history?supplierId=${id}&limit=20&page=1`);
      setHistory({ supplierId: id, rows: result.items });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "سوابق قیمت دریافت نشد."); }
  }

  async function createDrafts() {
    const groups = new Map<string, { supplierName: string; items: Array<{ inventoryItemId: string; locationId: string; quantity: string; unit: string; unitPriceToman: string }> }>();
    for (const row of selectedRows) {
      const supplier = row.preferredSupplier!;
      const groupId = `${supplier.id}:${row.locationId}`;
      const group = groups.get(groupId) ?? { supplierName: supplier.name, items: [] };
      group.items.push({ inventoryItemId: row.itemId, locationId: row.locationId, quantity: row.suggestedPurchaseQuantity!, unit: row.suggestedPurchaseUnit, unitPriceToman: row.estimatedUnitPriceToman ?? "0" });
      groups.set(groupId, group);
    }
    if (!groups.size) return;
    setBusy(true); setError(""); setNotice("");
    const created: Array<{ id: string; supplierName: string }> = [], failed: string[] = [];
    try {
      for (const [id, group] of groups) {
        try {
          const order = await api<{ id: string }>("/tenant/inventory/purchase-orders", { method: "POST", body: JSON.stringify({ supplierId: id.split(":")[0], items: group.items }) });
          created.push({ id: order.id, supplierName: group.supplierName });
        } catch { failed.push(group.supplierName); }
      }
      if (created.length) {
        setNotice(`${digits(created.length)} پیش‌نویس سفارش خرید ایجاد شد${failed.length ? `؛ ایجاد برای ${failed.join("، ")} ناموفق بود` : ""}. مبلغ‌ها برآوردی و قابل ویرایش‌اند.`);
        setSelectedItems({}); onDraftCreated(created[0]!.id);
      } else setError("پیش‌نویس سفارش خرید ایجاد نشد.");
    } finally { setBusy(false); }
  }

  return <div className="replenishment-workspace">
    <section className="inventory-panel">
      <div className="inventory-panel-head"><div><h2>پیشنهاد تأمین موجودی</h2><p>مقدار لازم تا موجودی هدف با سفارش‌های قطعی و بچ‌های منقضی‌شده محاسبه می‌شود؛ این صفحه پیش‌بینی تقاضا نیست.</p></div></div>
      <div className="replenishment-filters">
        <label>جست‌وجوی کالا<input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); setSelectedItems({}); }}/></label>
        <label>محل نگهداری<select value={locationId} onChange={(event) => { setLocationId(event.target.value); setPage(1); setSelectedItems({}); }}><option value="">همه محل‌ها</option>{locations.filter((location) => location.isActive).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label>وضعیت فعلی<select value={stockStatus} onChange={(event) => { setStockStatus(event.target.value); setPage(1); setSelectedItems({}); }}><option value="">همه وضعیت‌ها</option>{Object.entries(statusName).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      </div>
      {error && <p className="inventory-alert" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}
      {loading ? <p className="inventory-loading" role="status">در حال محاسبه…</p> : rows.items.map((row) => {
        const key = `${row.itemId}:${row.locationId}`;
        const warnings = row.dataWarnings.map((warning) => warningName[warning]).filter(Boolean);
        const canSelect = Boolean(canManage && row.preferredSupplier?.isActive && row.estimatedPurchaseCostToman !== null && row.replenishmentGap && row.replenishmentGap !== "0");
        return <article className="replenishment-card" key={key}>
          <header><div><h3>{row.name}</h3><small>{row.locationName} · وضعیت فعلی: {statusName[row.stockStatus ?? ""] ?? "تنظیم‌نشده"}</small></div><label className="replenishment-select"><input type="checkbox" checked={Boolean(selectedItems[key])} disabled={!canSelect || busy} onChange={(event) => setSelectedItems((current) => { const next = { ...current }; if (event.target.checked) next[key] = row; else delete next[key]; return next; })}/> انتخاب برای پیش‌نویس</label></header>
          <dl><div><dt>موجودی فعلی</dt><dd>{digits(row.quantity)} {unitName[row.unit] ?? row.unit}</dd></div><div><dt>حداقل</dt><dd>{row.minimumQuantity === null ? "—" : `${digits(row.minimumQuantity)} ${unitName[row.unit] ?? row.unit}`}</dd></div><div><dt>موجودی هدف</dt><dd>{row.parQuantity === null ? "تنظیم نشده" : `${digits(row.parQuantity)} ${unitName[row.unit] ?? row.unit}`}</dd></div><div><dt>در سفارش قطعی</dt><dd>{digits(row.onOrderQuantity)} {unitName[row.unit] ?? row.unit}</dd></div><div><dt>پس از دریافت سفارش‌های باز</dt><dd>{digits(row.projectedQuantity)} {unitName[row.unit] ?? row.unit}</dd></div><div><dt>لازم تا هدف</dt><dd>{row.replenishmentGap === null ? "بدون پیشنهاد؛ هدف تنظیم نشده" : `${digits(row.replenishmentGap)} ${unitName[row.unit] ?? row.unit}`}</dd></div><div><dt>حداقل سفارش تأمین‌کننده</dt><dd>{row.minimumOrderQuantity === null ? "—" : `${digits(row.minimumOrderQuantity)} ${unitName[row.suggestedPurchaseUnit] ?? row.suggestedPurchaseUnit}`}</dd></div><div><dt>مقدار پیشنهادی خرید</dt><dd>{row.suggestedPurchaseQuantity === null ? "—" : `${digits(row.suggestedPurchaseQuantity)} ${unitName[row.suggestedPurchaseUnit] ?? row.suggestedPurchaseUnit}`}</dd></div></dl>
          <div className="replenishment-supplier"><div><strong>تأمین‌کننده ترجیحی</strong><span>{row.preferredSupplier ? `${row.preferredSupplier.name}${row.preferredSupplier.isActive ? "" : " · غیرفعال"}` : "تنظیم نشده"}</span></div><div><strong>آخرین قیمت ثبت‌شده</strong><span>{row.latestNormalizedPriceTomanPerBaseUnit === null ? "ناموجود" : `${money(row.latestNormalizedPriceTomanPerBaseUnit)} تومان / ${unitName[row.baseUnit] ?? row.baseUnit}${row.lastPurchase ? ` · ${date(row.lastPurchase.receivedAt)}` : ""}`}</span></div><div><strong>برآورد این خرید</strong><span>{row.estimatedPurchaseCostToman === null ? "قیمت ثبت‌شده کافی نیست" : `${money(row.estimatedPurchaseCostToman)} تومان · بر اساس آخرین رسید`}</span></div></div>
          {row.expiredBatchQuantity !== "0" && <p className="replenishment-warning">بچ منقضی: {digits(row.expiredBatchQuantity)} {unitName[row.baseUnit] ?? row.baseUnit} · از مقدار لازم تا هدف کسر شد.</p>}
          {row.lastPurchase && <p className="replenishment-source">آخرین رسید: {digits(row.lastPurchase.quantity)} {unitName[row.lastPurchase.unit] ?? row.lastPurchase.unit} · واحدهای ثبت‌شده {row.lastPurchase.purchaseUnits} · نرخ نرمال‌شده {money(row.lastPurchase.normalizedPriceTomanPerBaseUnit)} تومان / {unitName[row.lastPurchase.unit] ?? row.lastPurchase.unit} · رسید {row.lastPurchase.receiptNumber}</p>}
          {row.priceChangePercent !== null && <p className="replenishment-source">تغییر قیمت نسبت به خرید قبلی همین تأمین‌کننده: {Number(row.priceChangePercent) > 0 ? "+" : ""}{digits(row.priceChangePercent)}٪</p>}
          {warnings.length > 0 && <ul className="replenishment-warnings">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>}
          <button type="button" className="inventory-secondary" onClick={() => void openComparison(row)}>مقایسه قیمت و تنظیم تأمین‌کننده</button>
        </article>;
      })}
      {!loading && !rows.items.length && <p className="purchase-empty">کالایی با این فیلتر پیدا نشد.</p>}
      <div className="inventory-actions"><button className="inventory-secondary" disabled={page<=1||loading} onClick={()=>setPage(page-1)}>قبلی</button><span>{digits(page)} از {digits(Math.max(1,Math.ceil(rows.total/rows.limit)))}</span><button className="inventory-secondary" disabled={page*rows.limit>=rows.total||loading} onClick={()=>setPage(page+1)}>بعدی</button>{canManage&&selectedRows.length>0&&<button className="inventory-primary" disabled={busy} onClick={()=>void createDrafts()}>ایجاد پیش‌نویس ({digits(selectedRows.length)})</button>}</div>
    </section>
    {comparison && <section className="inventory-panel replenishment-comparison" aria-labelledby="supplier-comparison-title">
      <div className="inventory-panel-head"><div><h2 id="supplier-comparison-title">مقایسه تأمین‌کنندگان · {comparison.item.name}</h2><p>قیمت‌ها از رسیدهای ثبت نهایی‌شده‌اند؛ قیمت امروز تأمین‌کننده را تضمین نمی‌کنند.</p></div><button type="button" className="inventory-secondary" onClick={()=>{setComparison(null);setHistory(null);}}>بستن</button></div>
      <div className="inventory-table-scroll" tabIndex={0}><table className="inventory-table"><thead><tr><th>تأمین‌کننده</th><th>آخرین قیمت نرمال‌شده</th><th>قیمت قبلی</th><th>تغییر</th><th>آخرین خرید</th><th>وضعیت</th><th></th></tr></thead><tbody>{comparison.suppliers.map((option)=><tr key={option.supplierId}>
        <td>{option.supplierName}{option.preferred?" · ترجیحی":""}</td><td>{option.latestNormalizedPriceTomanPerBaseUnit===null?"ناموجود":`${money(option.latestNormalizedPriceTomanPerBaseUnit)} تومان / ${unitName[comparison.item.baseUnit]??comparison.item.baseUnit}`}</td><td>{option.previousNormalizedPriceTomanPerBaseUnit===null?"—":`${money(option.previousNormalizedPriceTomanPerBaseUnit)} تومان`}</td><td>{option.priceChangePercent===null?"—":`${option.priceChangePercent.startsWith("-")?"":"+"}${digits(option.priceChangePercent)}٪`}</td><td>{option.latestPurchaseDate?date(option.latestPurchaseDate):"بدون سابقه"}{option.latestReceiptNumber?` · ${option.latestReceiptNumber}`:""}{option.latestPurchaseUnits?` · ${option.latestPurchaseUnits}`:""}</td><td>{option.supplierIsActive?"فعال":"غیرفعال"}</td><td><button type="button" className="inventory-link-button" onClick={()=>{if(option.supplierIsActive){setSupplierId(option.supplierId);setPurchaseUnit(option.preferredPurchaseUnit??option.latestUnit??comparison.item.unit);setMinimumOrderQuantity(option.minimumOrderQuantity??"");}}} disabled={!option.supplierIsActive}>انتخاب</button>{option.latestPurchaseDate&&<button type="button" className="inventory-link-button" onClick={()=>void showHistory(option.supplierId)}>سوابق</button>}</td>
      </tr>)}</tbody></table></div>
      {!comparison.suppliers.some((option)=>option.supplierIsActive)&&<p className="purchase-empty">تأمین‌کننده فعالی برای سفارش جدید وجود ندارد.</p>}
      {canManage&&supplierId&&<div className="replenishment-preference"><h3>تنظیم تأمین‌کننده ترجیحی</h3><label>تأمین‌کننده<select value={supplierId} onChange={(event)=>{const option=comparison.suppliers.find((row)=>row.supplierId===event.target.value);setSupplierId(event.target.value);setPurchaseUnit(option?.preferredPurchaseUnit??option?.latestUnit??comparison.item.unit);setMinimumOrderQuantity(option?.minimumOrderQuantity??"");}}>{comparison.suppliers.filter((option)=>option.supplierIsActive).map((option)=><option key={option.supplierId} value={option.supplierId}>{option.supplierName}</option>)}</select></label><label>واحد خرید<select value={purchaseUnit} onChange={(event)=>setPurchaseUnit(event.target.value)}>{unitOptions(comparison.item).map((unit)=><option key={unit} value={unit}>{unitName[unit]??unit}</option>)}</select></label><label>حداقل مقدار سفارش<input inputMode="decimal" value={minimumOrderQuantity} onChange={(event)=>setMinimumOrderQuantity(event.target.value)} placeholder="اختیاری"/></label><button type="button" className="inventory-primary" disabled={busy} onClick={()=>void savePreference()}>ذخیره تأمین‌کننده و واحد خرید</button>{comparison.item.preferredSupplier&&<button type="button" className="inventory-secondary" disabled={busy} onClick={()=>void clearPreference()}>پاک‌کردن تأمین‌کننده ترجیحی</button>}</div>}
      {history&&<section className="purchase-prices"><h3>تاریخچه واقعی رسیدها</h3>{history.rows.map((row)=><p key={`${row.receiptNumber}-${row.receivedAt}`}><strong>{row.receiptNumber} · {date(row.receivedAt)}</strong><span>{digits(row.quantity)} {unitName[row.unit]??row.unit} · واحدهای خرید {row.purchaseUnits} · جمع رسید {money(row.totalCostToman)} تومان · نرخ {money(row.normalizedPriceTomanPerBaseUnit)} تومان / {unitName[comparison.item.baseUnit]??comparison.item.baseUnit}</span></p>)}{!history.rows.length&&<small>رسید نهایی‌ای ثبت نشده است.</small>}</section>}
    </section>}
  </div>;
}
