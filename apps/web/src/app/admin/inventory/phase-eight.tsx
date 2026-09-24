"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../admin-session";

type Page<T> = { items: T[]; page: number; limit: number; total: number };
type InventoryItem = { id: string; name: string; baseUnit: string; isActive: boolean; batchTrackingEnabled: boolean };
type CountLine = { itemId: string; batchId: string | null; allocationType: "AGGREGATE" | "BATCH" | "UNALLOCATED"; batchNumber: string | null; expectedQuantity: string; countedQuantity: string; varianceQuantity: string | null };
type Count = { id: string; locationId: string; locationName: string; status: "DRAFT" | "COMPLETED"; lines?: CountLine[] };
type Batch = { id: string; batchNumber: string; supplierLotNumber: string | null; itemId: string; itemName: string; baseUnit: string; locationId: string; locationName: string; receivedAt: string; manufacturedDate: string | null; expiryDate: string | null; originalQuantity: string; remainingQuantity: string; originalQuantityBase: string; remainingQuantityBase: string; originType: string; goodsReceiptNumber: string | null; supplierName: string | null; status: string };
type BatchState = { quantityBase: string; unallocatedQuantity: string; unallocatedQuantityBase: string; batches: Array<{ id: string; batchNumber: string; expiryDate: string | null; remainingQuantityBase: string; status: string }> };
const statusName: Record<string, string> = { ACTIVE: "فعال", EXPIRING_SOON: "در آستانه انقضا", EXPIRED: "منقضی شده", NO_EXPIRY: "بدون تاریخ انقضا", DEPLETED: "تمام‌شده" };
const movementName: Record<string, string> = { PURCHASE_RECEIPT: "دریافت خرید", OPENING_BALANCE: "موجودی اولیه", SALE_CONSUMPTION: "مصرف سفارش", SALE_REVERSAL: "بازگشت سفارش", WASTE: "ضایعات", MANUAL_ADJUSTMENT: "اصلاح موجودی", STOCK_COUNT_ADJUSTMENT: "اصلاح انبارگردانی" };
const number = (value: string | number) => new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 6 }).format(Number(value));
const date = (value: string | null) => value ? new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("fa-IR") : "—";
const countKey = (itemId: string, mode: string, batchId?: string | null) => `${itemId}:${mode}:${batchId ?? "none"}`;

export function InventoryBatchesPanel({ items, locations, canManage }: { items: InventoryItem[]; locations: Array<{ id: string; name: string }>; canManage: boolean }) {
  const { api } = useAdminSession();
  const [page, setPage] = useState<Page<Batch>>({ items: [], page: 1, limit: 50, total: 0 });
  const [detail, setDetail] = useState<(Batch & { movements: Array<{ id: string; type: string; quantityBase: string; reason: string | null; createdAt: string }>; changes: Array<{ id: string; reason: string; createdAt: string }> }) | null>(null);
  const [state, setState] = useState<BatchState | null>(null);
  const [status, setStatus] = useState(""); const [itemId, setItemId] = useState(""); const [locationId, setLocationId] = useState(""); const [search, setSearch] = useState("");
  const [edit, setEdit] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const load = useCallback(async () => {
    const query = new URLSearchParams({ page: String(page.page), limit: "50" });
    if (status) query.set("status", status); if (itemId) query.set("itemId", itemId); if (locationId) query.set("locationId", locationId); if (search.trim()) query.set("search", search.trim());
    try { setPage(await api<Page<Batch>>(`/tenant/inventory/batches?${query}`)); setError(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "دریافت سری‌های موجودی انجام نشد."); }
  }, [api, page.page, status, itemId, locationId, search]);
  useEffect(() => { void load(); }, [load]);
  async function open(id: string) {
    setError(""); setEdit(false);
    try {
      const row = await api<Batch & { movements: Array<{ id: string; type: string; quantityBase: string; reason: string | null; createdAt: string }>; changes: Array<{ id: string; reason: string; createdAt: string }> }>(`/tenant/inventory/batches/${id}`);
      const balances = await api<BatchState>(`/tenant/inventory/items/${row.itemId}/batches?locationId=${row.locationId}`);
      setDetail(row); setState(balances);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "جزئیات سری موجودی پیدا نشد."); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!detail) return;
    const form = new FormData(event.currentTarget);
    const body = { supplierLotNumber: form.get("supplierLotNumber") || null, manufacturedDate: form.get("manufacturedDate") || null, expiryDate: form.get("expiryDate") || null, reason: form.get("reason") };
    setBusy(true); setError("");
    try { await api(`/tenant/inventory/batches/${detail.id}`, { method: "PATCH", body: JSON.stringify(body) }); setNotice("اطلاعات سری و هشدار انقضا به‌روز شد."); setEdit(false); await load(); await open(detail.id); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "اصلاح سری موجودی انجام نشد."); }
    finally { setBusy(false); }
  }
  return <div className="inventory-columns">
    <section className="inventory-panel"><div className="inventory-panel-head"><div><h2>سری‌های موجودی</h2><p>بچ‌های فعال، تاریخ‌گذشته و سوابق مصرف.</p></div></div>
      <div className="inventory-filters"><input value={search} onChange={(event) => { setSearch(event.target.value); setPage((old) => ({ ...old, page: 1 })); }} placeholder="جست‌وجوی کالا یا لات" aria-label="جست‌وجوی سری موجودی"/><select value={status} onChange={(event) => { setStatus(event.target.value); setPage((old) => ({ ...old, page: 1 })); }}><option value="">سری‌های دارای موجودی</option><option value="ACTIVE">فعال</option><option value="EXPIRING_SOON">در آستانه انقضا</option><option value="EXPIRED">منقضی شده</option><option value="NO_EXPIRY">بدون تاریخ انقضا</option><option value="DEPLETED">تمام‌شده</option><option value="ALL">همه</option></select><select value={itemId} onChange={(event) => { setItemId(event.target.value); setPage((old) => ({ ...old, page: 1 })); }}><option value="">همه کالاها</option>{items.filter((item) => item.batchTrackingEnabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select value={locationId} onChange={(event) => { setLocationId(event.target.value); setPage((old) => ({ ...old, page: 1 })); }}><option value="">همه محل‌ها</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
      {error && <p className="inventory-alert" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}
      <div className="inventory-table-scroll" tabIndex={0}><table className="inventory-table"><thead><tr><th>کالا / لات</th><th>محل</th><th>دریافت</th><th>انقضا</th><th>مانده</th><th>وضعیت</th></tr></thead><tbody>{page.items.map((batch) => <tr key={batch.id} className={detail?.id === batch.id ? "selected" : ""}><td><button className="inventory-link-button" onClick={() => void open(batch.id)}><strong>{batch.itemName}</strong><small>{batch.batchNumber}</small></button></td><td>{batch.locationName}</td><td>{new Date(batch.receivedAt).toLocaleDateString("fa-IR")}</td><td>{date(batch.expiryDate)}</td><td>{number(batch.remainingQuantity)} {batch.baseUnit}</td><td><span className={`inventory-status-badge status-${batch.status.toLowerCase()}`}>{statusName[batch.status] ?? batch.status}</span></td></tr>)}{!page.items.length && <tr><td colSpan={6}>سری موجودی برای این فیلتر وجود ندارد.</td></tr>}</tbody></table></div>
      <div className="inventory-actions"><button className="inventory-secondary" disabled={page.page <= 1} onClick={() => setPage({ ...page, page: page.page - 1 })}>قبلی</button><span>{number(page.page)} از {number(Math.max(1, Math.ceil(page.total / page.limit)))}</span><button className="inventory-secondary" disabled={page.page * page.limit >= page.total} onClick={() => setPage({ ...page, page: page.page + 1 })}>بعدی</button></div>
    </section>
    <section className="inventory-panel">{detail ? <><div className="inventory-panel-head"><div><span className={`inventory-status-badge status-${detail.status.toLowerCase()}`}>{statusName[detail.status] ?? detail.status}</span><h2>{detail.itemName} · {detail.batchNumber}</h2><p>{detail.locationName}{detail.supplierName ? ` · ${detail.supplierName}` : ""}{detail.goodsReceiptNumber ? ` · رسید ${detail.goodsReceiptNumber}` : ""}</p></div>{canManage && <button className="inventory-secondary" onClick={() => setEdit(!edit)}>{edit ? "بستن ویرایش" : "اصلاح لات یا تاریخ"}</button>}</div>
      <div className="inventory-metrics"><article><small>موجودی کل کالا در محل</small><strong>{number(state?.quantityBase ?? detail.remainingQuantityBase)} {detail.baseUnit}</strong></article><article><small>بدون بچ / قدیمی</small><strong>{number(state?.unallocatedQuantity ?? 0)} {detail.baseUnit}</strong></article><article><small>دریافتی اولیه</small><strong>{number(detail.originalQuantity)} {detail.baseUnit}</strong></article><article><small>مانده این سری</small><strong>{number(detail.remainingQuantity)} {detail.baseUnit}</strong></article></div>
      {edit && canManage && <form className="inventory-form" onSubmit={(event) => void save(event)}><label>شماره لات<input name="supplierLotNumber" maxLength={100} defaultValue={detail.supplierLotNumber ?? ""}/></label><label>تاریخ تولید<input type="date" name="manufacturedDate" defaultValue={detail.manufacturedDate ?? ""}/></label><label>تاریخ انقضا<input type="date" name="expiryDate" defaultValue={detail.expiryDate ?? ""}/></label><label className="inventory-wide">دلیل اصلاح (در سابقه ثبت می‌شود)<input name="reason" required maxLength={240}/></label><button className="inventory-primary" disabled={busy}>ثبت اصلاح</button></form>}
      <h3>تاریخچه حرکت</h3><div className="purchase-detail-lines">{detail.movements.map((movement) => <article key={movement.id}><strong>{movementName[movement.type] ?? movement.type}</strong><span>{number(movement.quantityBase)} {detail.baseUnit}</span><small>{new Date(movement.createdAt).toLocaleString("fa-IR")}{movement.reason ? ` · ${movement.reason}` : ""}</small></article>)}{!detail.movements.length && <p className="purchase-empty">حرکتی برای این سری ثبت نشده است.</p>}</div>
      {!!detail.changes.length && <><h3>اصلاحات اطلاعات سری</h3><div className="purchase-detail-lines">{detail.changes.map((change) => <article key={change.id}><strong>{change.reason}</strong><small>{new Date(change.createdAt).toLocaleString("fa-IR")}</small></article>)}</div></>}
    </> : <><h2>جزئیات سری موجودی</h2><p className="purchase-empty">برای مشاهده منبع دریافت، مانده، اصلاحات و حرکت‌های این سری را انتخاب کنید.</p></>}</section>
  </div>;
}

export function StockCountEditor({ count, items, canManage, changed }: { count: Count; items: InventoryItem[]; canManage: boolean; changed: (count: Count) => void }) {
  const { api } = useAdminSession();
  const [values, setValues] = useState<Record<string, string>>({}); const [batches, setBatches] = useState<Record<string, BatchState>>({}); const [loading, setLoading] = useState<Record<string, boolean>>({}); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  useEffect(() => { setValues(Object.fromEntries((count.lines ?? []).map((line) => [line.allocationType === "AGGREGATE" ? line.itemId : countKey(line.itemId, line.allocationType, line.batchId), line.countedQuantity]))); }, [count.id, count.lines]);
  const loadBatches = useCallback(async (itemId: string) => {
    if (batches[itemId] || loading[itemId]) return;
    setLoading((current) => ({ ...current, [itemId]: true }));
    try { const result = await api<BatchState>(`/tenant/inventory/items/${itemId}/batches?locationId=${count.locationId}`); setBatches((current) => ({ ...current, [itemId]: result })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "دریافت بچ‌ها برای شمارش انجام نشد."); }
    finally { setLoading((current) => ({ ...current, [itemId]: false })); }
  }, [api, batches, loading, count.locationId]);
  useEffect(() => { for (const itemId of new Set((count.lines ?? []).filter((line) => line.allocationType !== "AGGREGATE").map((line) => line.itemId))) void loadBatches(itemId); }, [count.id, count.lines, loadBatches]);
  function value(key: string, next: string) { setValues((current) => ({ ...current, [key]: next })); }
  function makeLines() {
    const lines: Array<{ itemId: string; batchId?: string; allocationType: "AGGREGATE" | "BATCH" | "UNALLOCATED"; countedQuantity: string }> = [];
    for (const item of items.filter((entry) => entry.isActive)) {
      if (!item.batchTrackingEnabled) { if (values[item.id]?.trim()) lines.push({ itemId: item.id, allocationType: "AGGREGATE", countedQuantity: values[item.id]! }); continue; }
      const state = batches[item.id]; if (!state) continue;
      const known = new Map((count.lines ?? []).filter((line) => line.itemId === item.id && line.allocationType === "BATCH" && line.batchId).map((line) => [line.batchId!, line]));
      for (const batch of state.batches.filter((row) => Number(row.remainingQuantityBase) > 0 || known.has(row.id))) {
        const counted = values[countKey(item.id, "BATCH", batch.id)];
        if (counted?.trim()) lines.push({ itemId: item.id, batchId: batch.id, allocationType: "BATCH", countedQuantity: counted });
      }
      const unallocated = values[countKey(item.id, "UNALLOCATED")];
      if (unallocated?.trim()) lines.push({ itemId: item.id, allocationType: "UNALLOCATED", countedQuantity: unallocated });
    }
    return lines;
  }
  async function save(complete: boolean) {
    setBusy(true); setError("");
    try {
      const saved = await api<Count>(`/tenant/inventory/counts/${count.id}/lines`, { method: "PATCH", body: JSON.stringify({ lines: makeLines() }) });
      if (complete) changed(await api<Count>(`/tenant/inventory/counts/${count.id}/complete`, { method: "POST" })); else changed(saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ذخیره شمارش انجام نشد."); }
    finally { setBusy(false); }
  }
  return <section className="inventory-panel"><div className="inventory-panel-head"><div><h2>شمارش {count.locationName}</h2><p>{count.status === "COMPLETED" ? "این انبارگردانی نهایی و قفل شده است." : "برای کالای بچ‌دار، هر سری و موجودی بدون بچ را جداگانه بشمارید."}</p></div></div>
    {error && <p className="inventory-alert" role="alert">{error}</p>}
    <div className="inventory-count-lines">{items.filter((item) => item.isActive).map((item) => {
      const aggregate = count.lines?.find((line) => line.itemId === item.id && line.allocationType === "AGGREGATE");
      const savedLines = count.lines?.filter((line) => line.itemId === item.id) ?? [];
      const state = batches[item.id];
      return <div key={item.id} className="inventory-count-item"><div><strong>{item.name}</strong><small>واحد: {item.baseUnit}{item.batchTrackingEnabled ? " · شمارش سری‌به‌سری" : ` · سامانه: ${aggregate?.expectedQuantity ?? "—"}`}</small></div>{!item.batchTrackingEnabled ? <input aria-label={`مقدار فیزیکی ${item.name}`} inputMode="decimal" placeholder="مقدار شمارش" disabled={count.status !== "DRAFT"} value={values[item.id] ?? ""} onChange={(event) => value(item.id, event.target.value)}/> : !state ? <button className="inventory-secondary" disabled={loading[item.id] || count.status !== "DRAFT"} onClick={() => void loadBatches(item.id)}>{loading[item.id] ? "در حال دریافت…" : "نمایش بچ‌ها برای شمارش"}</button> : <div className="inventory-count-batches">{state.batches.filter((batch) => Number(batch.remainingQuantityBase) > 0 || savedLines.some((line) => line.batchId === batch.id)).map((batch) => { const saved = savedLines.find((line) => line.batchId === batch.id); const key = countKey(item.id, "BATCH", batch.id); return <label key={batch.id}><span><strong>{batch.batchNumber}</strong><small>سامانه: {saved?.expectedQuantity ?? batch.remainingQuantityBase} {item.baseUnit}{batch.expiryDate ? ` · انقضا ${new Date(`${batch.expiryDate}T00:00:00`).toLocaleDateString("fa-IR")}` : ""}</small></span><input aria-label={`مقدار ${batch.batchNumber}`} inputMode="decimal" placeholder="مقدار شمارش" disabled={count.status !== "DRAFT"} value={values[key] ?? ""} onChange={(event) => value(key, event.target.value)}/></label>; })}<label><span><strong>موجودی بدون بچ</strong><small>سامانه: {savedLines.find((line) => line.allocationType === "UNALLOCATED")?.expectedQuantity ?? state.unallocatedQuantity} {item.baseUnit}</small></span><input aria-label={`موجودی بدون بچ ${item.name}`} inputMode="decimal" placeholder="مقدار شمارش (حتی صفر)" disabled={count.status !== "DRAFT"} value={values[countKey(item.id, "UNALLOCATED")] ?? ""} onChange={(event) => value(countKey(item.id, "UNALLOCATED"), event.target.value)}/></label></div>}</div>;
    })}</div>
    {count.status === "DRAFT" && canManage && <div className="inventory-actions"><button className="inventory-secondary" disabled={busy} onClick={() => void save(false)}>ذخیره پیش‌نویس</button><button className="inventory-primary" disabled={busy || !makeLines().length} onClick={() => void save(true)}>ثبت نهایی و اصلاح موجودی</button></div>}
  </section>;
}
