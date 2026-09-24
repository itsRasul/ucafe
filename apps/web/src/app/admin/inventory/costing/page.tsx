"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { useAdminSession } from "../../admin-session";
import "../inventory.css";
import { percent, toman } from "./costing-format";

type CostStatus = "COMPLETE" | "INCOMPLETE" | "NO_COST_DATA" | "NO_ACTIVE_VERSION" | "NOT_CONFIGURED";
type MissingCost = { inventoryItemId: string; inventoryItemName: string; quantity: string; unit: string; itemActive: boolean; reason: string };
type MenuRow = {
  menuItemId: string; menuItemVariantId: string | null; menuItemName: string; variantName: string | null;
  categoryName: string; isArchived: boolean; isAvailable: boolean; sellingPriceToman: string | null;
  recipeId: string | null; recipeVersionId: string | null; recipeVersionNumber: number | null; recipeFallback: string | null;
  costStatus: CostStatus; componentCount: number; costedComponentCount: number; missingCostCount: number; inactiveComponentCount: number;
  totalKnownCostToman: string | null; recipeCostToman: string | null; grossProfitToman: string | null;
  grossMarginPercent: string | null; materialCostPercent: string | null; missingCostItems: MissingCost[];
  costSemantics: string; costBasis: string; costLocation: { id: string; name: string } | null;
};
type MenuPage = { items: MenuRow[]; page: number; limit: number; total: number; categories: Array<{ id: string; name: string }> };
type CostComponent = {
  recipeComponentId: string; inventoryItemId: string; inventoryItemName: string; quantity: string; unit: string;
  normalizedQuantity: string; normalizedUnit: string; normalizedUnitCostToman: string | null;
  componentCostToman: string | null; costAvailable: boolean; itemActive: boolean; note: string | null;
};
type RecipeCost = {
  recipeId: string; recipeVersionId: string | null; recipeVersionNumber: number | null; recipeVersionStatus: string | null;
  costSemantics: string; costBasis: string; costLocation: { id: string; name: string } | null; costStatus: CostStatus;
  componentCount: number; costedComponentCount: number; missingCostCount: number; inactiveComponentCount: number;
  totalKnownCostToman: string | null; recipeCostToman: string | null; sellingPriceToman: string | null;
  grossProfitToman: string | null; grossMarginPercent: string | null; materialCostPercent: string | null;
  components: CostComponent[]; missingCostItems: MissingCost[];
};

const statusNames: Record<CostStatus, string> = {
  COMPLETE: "هزینه کامل", INCOMPLETE: "هزینه ناقص", NO_COST_DATA: "هزینه ثبت نشده",
  NO_ACTIVE_VERSION: "نسخه فعال ندارد", NOT_CONFIGURED: "رسپی تعریف نشده",
};
const unitNames: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const rowKey = (row: Pick<MenuRow, "menuItemId" | "menuItemVariantId">) => `${row.menuItemId}:${row.menuItemVariantId ?? "base"}`;
const recipeHref = (row: MenuRow, variantId: string | null = row.menuItemVariantId) => `/admin/inventory/recipes?menuItemId=${encodeURIComponent(row.menuItemId)}${variantId ? `&variantId=${encodeURIComponent(variantId)}` : ""}`;

export default function CostingPage() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("inventory.read") || access.permissions.includes("inventory.manage");
  const [data, setData] = useState<MenuPage>({ items: [], page: 1, limit: 25, total: 0, categories: [] });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [activeSearch, setActiveSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [status, setStatus] = useState("");
  const [sortBy, setSortBy] = useState("grossMargin");
  const [sortDirection, setSortDirection] = useState<"ASC" | "DESC">("DESC");
  const [includeUnavailable, setIncludeUnavailable] = useState(false);
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<RecipeCost | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!canRead || access.features?.inventory === false) return;
    setBusy(true); setError("");
    const query = new URLSearchParams({ page: String(page), limit: "25", sortBy, sortDirection });
    if (activeSearch) query.set("search", activeSearch);
    if (categoryId) query.set("categoryId", categoryId);
    if (status) query.set("costingStatus", status);
    if (includeUnavailable) query.set("includeUnavailable", "true");
    try { setData(await api<MenuPage>(`/tenant/inventory/profitability/menu?${query}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "دریافت هزینه منو ممکن نشد."); }
    finally { setBusy(false); }
  }, [access.features?.inventory, activeSearch, api, canRead, categoryId, includeUnavailable, page, sortBy, sortDirection, status]);

  useEffect(() => { void load(); }, [load]);

  async function toggleDetail(row: MenuRow) {
    const key = rowKey(row);
    if (selected === key) { setSelected(""); setDetail(null); return; }
    setSelected(key); setDetail(null); setError("");
    if (!row.recipeId || !row.recipeVersionId) return;
    setDetailBusy(true);
    const query = new URLSearchParams({ versionId: row.recipeVersionId });
    try { setDetail(await api<RecipeCost>(`/tenant/inventory/recipes/${row.recipeId}/cost?${query}`)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "جزئیات هزینه دریافت نشد."); }
    finally { setDetailBusy(false); }
  }

  function applySearch(event: FormEvent) { event.preventDefault(); setPage(1); setActiveSearch(search.trim()); }

  if (!canRead) return <section className="inventory-state"><h1>دسترسی به هزینه منو ندارید</h1><p>نقش شما اجازه مشاهده اطلاعات موجودی این کافه را ندارد.</p></section>;
  if (access.features?.inventory === false) return <section className="inventory-state"><span>موجودی</span><h1>این قابلیت در طرح فعلی فعال نیست</h1><p>برای مشاهده هزینه رسپی، وضعیت اشتراک را بررسی کنید.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="inventory-page costing-page" dir="rtl">
    <header className="inventory-heading"><div><span>موجودی و منو</span><h1>بهای مواد و سود ناخالص</h1><p>رسپی، میانگین هزینه محل پیش‌فرض و قیمت فروش امروز؛ بدون هزینه‌های عملیاتی.</p></div><div className="inventory-heading-actions"><Link className="inventory-secondary" href="/admin/inventory/recipes">دستور مواد</Link><Link className="inventory-secondary" href="/admin/inventory">بازگشت به موجودی</Link></div></header>
    <p className="costing-disclaimer">این برآورد فقط هزینه مواد رسپی را محاسبه می‌کند و حقوق، اجاره، مالیات و سایر هزینه‌های عملیاتی را شامل نمی‌شود. نسخه‌های قدیمی نیز با هزینه‌های فعلی نمایش داده می‌شوند، نه هزینه تاریخی.</p>
    {error && <p className="inventory-alert" role="alert">{error}</p>}
    <section className="inventory-panel">
      <div className="inventory-panel-head"><div><h2>هزینه فعلی محصولات</h2><p>برای محصول بدون رسپی یا هزینه ناقص، سود و حاشیه قطعی نشان داده نمی‌شود.</p></div><span className="costing-result-count">{new Intl.NumberFormat("fa-IR").format(data.total)} مورد</span></div>
      <form className="inventory-filters costing-filters" onSubmit={applySearch}>
        <input aria-label="جست‌وجوی محصول یا اندازه" placeholder="جست‌وجوی محصول یا اندازه" value={search} onChange={(event) => setSearch(event.target.value)} />
        <select aria-label="وضعیت محاسبه" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
          <option value="">همه وضعیت‌ها</option><option value="COMPLETE">هزینه کامل</option><option value="INCOMPLETE">هزینه ناقص</option><option value="NO_COST_DATA">بدون هزینه ثبت‌شده</option><option value="NO_ACTIVE_VERSION">بدون نسخه فعال</option><option value="NOT_CONFIGURED">بدون رسپی</option>
        </select>
        <select aria-label="دسته‌بندی منو" value={categoryId} onChange={(event) => { setCategoryId(event.target.value); setPage(1); }}>
          <option value="">همه دسته‌بندی‌ها</option>{data.categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
        </select>
        <select aria-label="مرتب‌سازی" value={sortBy} onChange={(event) => { setSortBy(event.target.value); setPage(1); }}>
          <option value="grossMargin">حاشیه سود ناخالص</option><option value="grossProfit">سود ناخالص</option><option value="recipeCost">بهای رسپی</option><option value="sellingPrice">قیمت فروش</option><option value="materialCost">درصد بهای مواد</option>
        </select>
        <select aria-label="ترتیب" value={sortDirection} onChange={(event) => { setSortDirection(event.target.value as "ASC" | "DESC"); setPage(1); }}><option value="DESC">نزولی</option><option value="ASC">صعودی</option></select>
        <label className="inventory-check"><input type="checkbox" checked={includeUnavailable} onChange={(event) => { setIncludeUnavailable(event.target.checked); setPage(1); }} />نمایش ناموجودها</label>
        <button className="inventory-primary" disabled={busy}>جست‌وجو</button>
      </form>
      {busy && !data.items.length ? <div className="costing-skeleton" role="status" aria-label="در حال دریافت هزینه محصولات"><i /><i /><i /></div> : <div className="profitability-list">
        {data.items.map((row) => <article key={rowKey(row)} className={`profitability-row ${selected === rowKey(row) ? "expanded" : ""}`}>
          <header className="profitability-title"><div><h3>{row.menuItemName}{row.variantName ? <span> — {row.variantName}</span> : null}</h3><small>{row.categoryName}{row.isArchived ? " · بایگانی‌شده" : row.isAvailable ? " · قابل سفارش" : " · ناموجود"}</small></div><b className={`recipe-status costing-status costing-${row.costStatus.toLowerCase()}`}>{statusNames[row.costStatus]}</b></header>
          {row.recipeFallback && <p className="costing-hint">هزینه از رسپی اصلی محصول به‌دست آمده است.</p>}
          <dl className="profitability-metrics">
            <div><dt>قیمت فروش</dt><dd>{toman(row.sellingPriceToman)}</dd></div>
            <div><dt>بهای رسپی</dt><dd>{row.recipeCostToman !== null ? toman(row.recipeCostToman) : row.totalKnownCostToman !== null ? `حداقل ${toman(row.totalKnownCostToman)} · ناقص` : "نامشخص"}</dd></div>
            <div><dt>سود ناخالص</dt><dd className={row.grossProfitToman?.startsWith("-") ? "negative-stock" : ""}>{toman(row.grossProfitToman)}</dd></div>
            <div><dt>حاشیه سود</dt><dd>{percent(row.grossMarginPercent)}</dd></div>
            <div><dt>درصد بهای مواد</dt><dd>{percent(row.materialCostPercent)}</dd></div>
            <div><dt>مواد قیمت‌گذاری‌شده</dt><dd>{row.componentCount ? `${new Intl.NumberFormat("fa-IR").format(row.costedComponentCount)} از ${new Intl.NumberFormat("fa-IR").format(row.componentCount)}` : "—"}</dd></div>
          </dl>
          {row.missingCostItems.length > 0 && <p className="costing-missing-summary">هزینه نامشخص: {row.missingCostItems.map((item) => item.inventoryItemName).join("، ")}</p>}
          {row.inactiveComponentCount > 0 && <p className="costing-warning">این رسپی شامل {new Intl.NumberFormat("fa-IR").format(row.inactiveComponentCount)} کالای غیرفعال است.</p>}
          <div className="profitability-actions">
            {row.recipeId && <button className="inventory-link-button" type="button" onClick={() => void toggleDetail(row)}>{selected === rowKey(row) ? "بستن جزئیات" : "ریز هزینه مواد"}</button>}
            {!row.recipeId && <Link className="inventory-link-button" href={recipeHref(row)}>تعریف رسپی</Link>}
            {row.costStatus === "NO_COST_DATA" || row.costStatus === "INCOMPLETE" ? <Link className="inventory-link-button" href="/admin/inventory/purchasing">ثبت هزینه خرید</Link> : null}
            {row.costStatus === "NO_ACTIVE_VERSION" && <Link className="inventory-link-button" href={recipeHref(row, row.recipeFallback === "MENU_ITEM" ? null : row.menuItemVariantId)}>بررسی نسخه رسپی</Link>}
          </div>
          {selected === rowKey(row) && <CostBreakdown row={row} detail={detail} busy={detailBusy} />}
        </article>)}
        {!data.items.length && <div className="recipe-empty-state"><h2>{activeSearch || status || categoryId ? "محصولی با این فیلتر پیدا نشد" : "محصولی برای محاسبه وجود ندارد"}</h2><p>برای مشاهده بهای مواد، ابتدا در منو رسپی تعریف کنید و میانگین قیمت مواد را از رسید خرید ثبت کنید.</p><Link href="/admin/inventory/recipes">رفتن به دستور مواد</Link></div>}
      </div>}
      {data.total > data.limit && <div className="inventory-actions"><button className="inventory-secondary" disabled={page <= 1 || busy} onClick={() => setPage(page - 1)}>صفحه قبل</button><span>{new Intl.NumberFormat("fa-IR").format(data.page)} از {new Intl.NumberFormat("fa-IR").format(Math.max(1, Math.ceil(data.total / data.limit)))}</span><button className="inventory-secondary" disabled={page * data.limit >= data.total || busy} onClick={() => setPage(page + 1)}>صفحه بعد</button></div>}
    </section>
  </section>;
}

function CostBreakdown({ row, detail, busy }: { row: MenuRow; detail: RecipeCost | null; busy: boolean }) {
  if (busy) return <p className="inventory-loading" role="status">در حال محاسبه اجزای هزینه…</p>;
  if (!detail) return <p className="costing-hint">برای این محصول رسپی فعال وجود ندارد یا جزئیات هزینه بارگذاری نشد.</p>;
  return <section className="cost-breakdown" aria-label={`جزئیات بهای رسپی ${row.menuItemName}`}>
    <div className="cost-breakdown-heading"><div><h4>نسخه {detail.recipeVersionNumber ? new Intl.NumberFormat("fa-IR").format(detail.recipeVersionNumber) : "—"} · برآورد با قیمت امروز</h4><p>{detail.costLocation ? `میانگین هزینه محل پیش‌فرض: ${detail.costLocation.name}` : "محل پیش‌فرضی برای قیمت‌گذاری پیدا نشد."}</p></div><Link className="inventory-link-button" href={recipeHref(row, row.recipeFallback === "MENU_ITEM" ? null : row.menuItemVariantId)}>ویرایش رسپی</Link></div>
    {detail.recipeVersionStatus === "SUPERSEDED" && <p className="costing-hint">این نسخه پیشین است؛ مقادیر همان نسخه با میانگین هزینه فعلی محاسبه شده‌اند.</p>}
    {detail.inactiveComponentCount > 0 && <p className="costing-warning">مواد غیرفعال در محاسبه حذف نشده‌اند؛ وضعیت آن‌ها را در موجودی بررسی کنید.</p>}
    <div className="cost-breakdown-table"><div className="cost-breakdown-head"><span>ماده و مقدار</span><span>میانگین هر واحد پایه</span><span>هزینه جزء</span></div>
      {detail.components.map((component) => <div className="cost-breakdown-line" key={component.recipeComponentId}>
        <span><strong>{component.inventoryItemName}</strong><small>{component.quantity} {unitNames[component.unit] ?? component.unit} · پایه {component.normalizedQuantity} {unitNames[component.normalizedUnit] ?? component.normalizedUnit}{!component.itemActive ? " · غیرفعال" : ""}</small></span>
        <span>{component.costAvailable ? `${toman(component.normalizedUnitCostToman)} / ${unitNames[component.normalizedUnit] ?? component.normalizedUnit}` : "هزینه ثبت نشده"}</span>
        <span>{component.costAvailable ? toman(component.componentCostToman) : "نامشخص"}</span>
      </div>)}
      {!detail.components.length && <p className="recipe-empty">این نسخه ماده‌ای ندارد و قابل محاسبه نیست.</p>}
    </div>
    {detail.costStatus !== "COMPLETE" && detail.totalKnownCostToman !== null && <p className="costing-hint">جمع هزینه‌های مشخص تا اینجا: {toman(detail.totalKnownCostToman)}؛ این مبلغ کامل نیست.</p>}
    {detail.missingCostItems.length > 0 && <p className="costing-missing-summary">برای تکمیل محاسبه، هزینه این مواد را از طریق رسید خرید ثبت کنید: {detail.missingCostItems.map((item) => item.inventoryItemName).join("، ")}.</p>}
    <div className="cost-breakdown-total"><strong>{detail.costStatus === "COMPLETE" ? `بهای رسپی: ${toman(detail.recipeCostToman)}` : statusNames[detail.costStatus]}</strong>{detail.costStatus === "COMPLETE" && <span>قیمت فروش {toman(detail.sellingPriceToman)} · سود ناخالص {toman(detail.grossProfitToman)} · حاشیه {percent(detail.grossMarginPercent)} · بهای مواد {percent(detail.materialCostPercent)}</span>}</div>
  </section>;
}
