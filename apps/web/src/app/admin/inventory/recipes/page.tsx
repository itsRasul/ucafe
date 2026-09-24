"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../../admin-session";
import "../inventory.css";
import { percent, toman } from "../costing/costing-format";

type Target = { menuItemId: string; menuItemVariantId: string | null; menuItemName: string; variantName: string | null; isArchived: boolean; isAvailable: boolean; recipeId: string | null; status: "NONE" | "DRAFT" | "ACTIVE"; activeVersionId: string | null; activeVersionNumber: number | null; effectiveFrom: string | null; draftVersionId: string | null; draftVersionNumber: number | null; draftRevision: number | null; componentCount: number; updatedAt: string };
type Ingredient = { id: string; name: string; dimension: "WEIGHT" | "VOLUME" | "COUNT"; baseUnit: string; isActive: boolean };
type Component = { id: string; inventoryItemId: string; inventoryItemName: string; quantity: string; unit: string; quantityBase: string; baseUnit: string; dimension: Ingredient["dimension"]; itemActive: boolean; note: string | null };
type Version = { id: string; versionNumber: number; status: "DRAFT" | "ACTIVE" | "SUPERSEDED"; revision: number; createdByUserId: string | null; publishedByUserId: string | null; effectiveFrom: string | null; createdAt: string; updatedAt: string; components: Component[] };
type Recipe = { id: string; menuItemId: string; menuItemVariantId: string | null; menuItemName: string; variantName: string | null; menuItemDeletedAt: string | null; versions: Version[] };
type Page<T> = { items: T[]; page: number; limit: number; total: number };
type DraftLine = { inventoryItemId: string; quantity: string; unit: string; note: string };
type CostLine = { recipeComponentId: string; inventoryItemName: string; quantity: string; unit: string; normalizedQuantity: string; normalizedUnit: string; normalizedUnitCostToman: string | null; componentCostToman: string | null; costAvailable: boolean; itemActive: boolean };
type CostSummary = { recipeVersionNumber: number | null; recipeVersionStatus: string | null; costStatus: string; costLocation: { id: string; name: string } | null; componentCount: number; costedComponentCount: number; inactiveComponentCount: number; totalKnownCostToman: string | null; recipeCostToman: string | null; sellingPriceToman: string | null; grossProfitToman: string | null; grossMarginPercent: string | null; materialCostPercent: string | null; components: CostLine[]; missingCostItems: Array<{ inventoryItemName: string }> };
const units: Record<string, string> = { g: "گرم", kg: "کیلوگرم", ml: "میلی‌لیتر", l: "لیتر", piece: "عدد", pack: "بسته", box: "جعبه", bottle: "بطری" };
const statusNames: Record<Target["status"] | Version["status"], string> = { NONE: "بدون دستور", DRAFT: "پیش‌نویس", ACTIVE: "فعال", SUPERSEDED: "نسخه پیشین" };
const fa = (value: string | number) => new Intl.NumberFormat("fa-IR").format(Number(value));
const keyOf = (target: Pick<Target, "menuItemId" | "menuItemVariantId">) => `${target.menuItemId}:${target.menuItemVariantId ?? "base"}`;
const labelOf = (target: Pick<Target, "menuItemName" | "variantName">) => target.variantName ? `${target.menuItemName} — ${target.variantName}` : target.menuItemName;
const unitsFor = (item: Ingredient) => item.dimension === "WEIGHT" ? ["g", "kg"] : item.dimension === "VOLUME" ? ["ml", "l"] : [item.baseUnit];

export default function RecipesPage() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("inventory.read") || access.permissions.includes("inventory.manage");
  const canManage = access.permissions.includes("inventory.manage");
  const [targets, setTargets] = useState<Target[]>([]);
  const [ingredients, setIngredients] = useState<Ingredient[]>([]);
  const [recipe, setRecipe] = useState<Recipe | null>(null);
  const [selectedTarget, setSelectedTarget] = useState("");
  const [selectedVersionId, setSelectedVersionId] = useState("");
  const [draft, setDraft] = useState<DraftLine[]>([]);
  const [copyFrom, setCopyFrom] = useState("");
  const [search, setSearch] = useState("");
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [requestedMenuItem, setRequestedMenuItem] = useState("");
  const [requestedMenuVariant, setRequestedMenuVariant] = useState("");
  const [linkHandled, setLinkHandled] = useState(false);
  const [cost, setCost] = useState<CostSummary | null>(null);
  const [costBusy, setCostBusy] = useState(false);
  const [costError, setCostError] = useState("");

  const loadTargets = useCallback(async () => {
    const rows = await api<Target[]>("/tenant/inventory/recipes");
    setTargets(rows);
    return rows;
  }, [api]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setRequestedMenuItem(params.get("menuItemId") ?? "");
    setRequestedMenuVariant(params.get("variantId") ?? "");
  }, []);

  useEffect(() => {
    if (!canRead || access.features?.inventory === false) return;
    let canceled = false;
    setBusy(true);
    Promise.all([
      loadTargets(),
      canManage ? api<Page<Ingredient>>("/tenant/inventory/items?limit=100&page=1").then(async (first) => {
        const rest = await Promise.all(Array.from({ length: Math.ceil(first.total / 100) - 1 }, (_, index) => api<Page<Ingredient>>(`/tenant/inventory/items?limit=100&page=${index + 2}`)));
        return [first, ...rest].flatMap((page) => page.items);
      }) : Promise.resolve([]),
    ]).then(([, items]) => { if (!canceled) setIngredients(items); })
      .catch((reason: Error) => { if (!canceled) setError(reason.message || "دریافت دستورها ممکن نشد."); })
      .finally(() => { if (!canceled) setBusy(false); });
    return () => { canceled = true; };
  }, [access.features?.inventory, api, canManage, canRead, loadTargets]);

  useEffect(() => {
    if (!requestedMenuItem || !targets.length || linkHandled) return;
    const target = targets.find((row) => row.menuItemId === requestedMenuItem && row.menuItemVariantId === (requestedMenuVariant || null));
    if (!target) return;
    setSelectedTarget(keyOf(target));
    setLinkHandled(true);
    if (target.recipeId) void openRecipe(target.recipeId);
  }, [linkHandled, requestedMenuItem, requestedMenuVariant, targets]);

  const selectedVersion = recipe?.versions.find((version) => version.id === selectedVersionId) ?? null;
  const savedDraft = selectedVersion?.components.map((component) => ({ inventoryItemId: component.inventoryItemId, quantity: component.quantity, unit: component.unit, note: component.note ?? "" })) ?? [];
  const draftHasChanges = selectedVersion?.status === "DRAFT" && JSON.stringify(draft) !== JSON.stringify(savedDraft);
  const visibleTargets = useMemo(() => targets.filter((target) => {
    const text = `${target.menuItemName} ${target.variantName ?? ""}`.toLocaleLowerCase();
    return (!onlyMissing || target.status === "NONE") && (!search.trim() || text.includes(search.trim().toLocaleLowerCase()));
  }), [onlyMissing, search, targets]);
  const copySources = targets.filter((target) => target.recipeId && target.status === "ACTIVE" && !target.isArchived);

  useEffect(() => {
    if (!recipe || !selectedVersion) { setCost(null); return; }
    let canceled = false;
    const query = new URLSearchParams({ versionId: selectedVersion.id });
    setCostBusy(true); setCostError("");
    api<CostSummary>(`/tenant/inventory/recipes/${recipe.id}/cost?${query}`)
      .then((result) => { if (!canceled) setCost(result); })
      .catch((reason: Error) => { if (!canceled) setCostError(reason.message || "محاسبه بهای رسپی انجام نشد."); })
      .finally(() => { if (!canceled) setCostBusy(false); });
    return () => { canceled = true; };
  }, [api, recipe?.id, selectedVersion?.id, selectedVersion?.revision, selectedVersion?.status]);

  async function openRecipe(id: string) {
    setBusy(true); setError("");
    try {
      const loaded = await api<Recipe>(`/tenant/inventory/recipes/${id}`);
      setRecipe(loaded);
      const current = loaded.versions.find((version) => version.status === "DRAFT") ?? loaded.versions[0];
      setSelectedVersionId(current?.id ?? "");
      setDraft((current?.components ?? []).map((component) => ({ inventoryItemId: component.inventoryItemId, quantity: component.quantity, unit: component.unit, note: component.note ?? "" })));
      setSelectedTarget("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "دستور پیدا نشد."); }
    finally { setBusy(false); }
  }

  function selectVersion(version: Version) {
    setSelectedVersionId(version.id);
    setDraft(version.components.map((component) => ({ inventoryItemId: component.inventoryItemId, quantity: component.quantity, unit: component.unit, note: component.note ?? "" })));
  }

  async function createRecipe(event: FormEvent) {
    event.preventDefault();
    const target = targets.find((row) => keyOf(row) === selectedTarget);
    if (!target) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const path = copyFrom ? `/tenant/inventory/recipes/${copyFrom}/duplicate` : "/tenant/inventory/recipes";
      const created = await api<Recipe>(path, { method: "POST", body: JSON.stringify({ menuItemId: target.menuItemId, menuItemVariantId: target.menuItemVariantId }) });
      setRecipe(created);
      const current = created.versions[0]; setSelectedVersionId(current?.id ?? "");
      setDraft((current?.components ?? []).map((component) => ({ inventoryItemId: component.inventoryItemId, quantity: component.quantity, unit: component.unit, note: component.note ?? "" })));
      setSelectedTarget(""); setCopyFrom("");
      await loadTargets(); setNotice("پیش‌نویس دستور ساخته شد.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ساخت دستور انجام نشد."); }
    finally { setBusy(false); }
  }

  async function newVersion() {
    if (!recipe) return;
    setBusy(true); setError("");
    try {
      await api(`/tenant/inventory/recipes/${recipe.id}/versions`, { method: "POST" });
      const loaded = await api<Recipe>(`/tenant/inventory/recipes/${recipe.id}`); setRecipe(loaded);
      const current = loaded.versions.find((version) => version.status === "DRAFT")!;
      selectVersion(current); await loadTargets();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ساخت نسخه جدید انجام نشد."); }
    finally { setBusy(false); }
  }

  async function saveDraft(): Promise<boolean> {
    if (!recipe || !selectedVersion || selectedVersion.status !== "DRAFT") return false;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/inventory/recipes/${recipe.id}/versions/${selectedVersion.id}/components`, { method: "PATCH", body: JSON.stringify({ expectedRevision: selectedVersion.revision, components: draft }) });
      const loaded = await api<Recipe>(`/tenant/inventory/recipes/${recipe.id}`); setRecipe(loaded);
      const current = loaded.versions.find((version) => version.id === selectedVersion.id)!; selectVersion(current);
      await loadTargets(); setNotice("پیش‌نویس ذخیره شد."); return true;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ذخیره پیش‌نویس انجام نشد."); return false; }
    finally { setBusy(false); }
  }

  async function publishDraft() {
    if (!recipe || !selectedVersion || selectedVersion.status !== "DRAFT") return;
    if (!await saveDraft()) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const updated = await api<Recipe>(`/tenant/inventory/recipes/${recipe.id}/versions/${selectedVersion.id}/publish`, { method: "POST" });
      setRecipe(updated); const active = updated.versions.find((version) => version.status === "ACTIVE");
      if (active) selectVersion(active);
      await loadTargets(); setNotice("نسخه منتشر شد؛ نسخه‌های قبلی بدون تغییر باقی ماندند.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "انتشار دستور انجام نشد."); }
    finally { setBusy(false); }
  }

  if (!canRead) return <section className="inventory-state"><h1>دسترسی به دستورها ندارید</h1><p>نقش شما اجازه مشاهده دستورهای مواد این کافه را ندارد.</p></section>;
  if (access.features?.inventory === false) return <section className="inventory-state"><span>موجودی</span><h1>این قابلیت در طرح فعلی فعال نیست</h1><p>برای مدیریت دستور مواد، وضعیت اشتراک را بررسی کنید.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="inventory-page recipe-page" dir="rtl">
    <header className="inventory-heading"><div><span>موجودی و منو</span><h1>دستور مواد</h1><p>نسخه‌های منتشرشده، دستور فعال هر آیتم را برای سفارش‌های آینده مشخص می‌کنند.</p></div><div className="costing-heading-links"><Link className="inventory-secondary" href="/admin/inventory/costing">بهای مواد و سود</Link><Link className="inventory-secondary" href="/admin/inventory">بازگشت به موجودی</Link></div></header>
    {error && <p className="inventory-alert" role="alert">{error}</p>}{notice && <p className="inventory-notice" role="status">{notice}</p>}
    <div className="recipe-layout">
      <section className="inventory-panel recipe-list-panel">
        <div className="inventory-panel-head"><div><h2>پوشش منو</h2><p>دستور اختیاری است؛ فقط آیتم‌های نیازمند مدیریت را کامل کنید.</p></div></div>
        <div className="inventory-filters"><input aria-label="جست‌وجوی منو" placeholder="جست‌وجوی آیتم یا اندازه" value={search} onChange={(event) => setSearch(event.target.value)} /><label className="inventory-check"><input type="checkbox" checked={onlyMissing} onChange={(event) => setOnlyMissing(event.currentTarget.checked)} />فقط بدون دستور</label></div>
        <div className="recipe-target-list">{visibleTargets.map((target) => <article key={keyOf(target)} className={selectedTarget === keyOf(target) ? "selected" : ""}>
          <button type="button" className="recipe-target" onClick={() => { setSelectedTarget(keyOf(target)); setRecipe(null); }}><span><strong>{labelOf(target)}</strong><small>{target.isArchived ? "آیتم بایگانی شده" : target.isAvailable ? "قابل سفارش" : "فعلاً ناموجود"}{target.draftVersionNumber ? ` · پیش‌نویس v${fa(target.draftVersionNumber)}` : ""}</small></span><b className={`recipe-status recipe-${target.status.toLowerCase()}`}>{statusNames[target.status]}{target.activeVersionNumber ? ` v${fa(target.activeVersionNumber)}` : ""}</b></button>
          {target.recipeId && <button type="button" className="recipe-open" onClick={() => void openRecipe(target.recipeId!)}>نسخه‌ها · {fa(target.componentCount)} ماده</button>}
          {!target.recipeId && canManage && <button type="button" className="recipe-open" onClick={() => { setSelectedTarget(keyOf(target)); setRecipe(null); }}>ساخت دستور</button>}
        </article>)}{!visibleTargets.length && <p className="recipe-empty">آیتمی با این جست‌وجو پیدا نشد.</p>}</div>
      </section>

      <section className="inventory-panel recipe-editor-panel">
        {selectedTarget && !recipe ? (() => {
          const target = targets.find((row) => keyOf(row) === selectedTarget);
          return target ? <form onSubmit={createRecipe} className="recipe-create-form"><h2>دستور {labelOf(target)}</h2><p>نسخه اول به‌صورت پیش‌نویس ساخته می‌شود و موجودی را تغییر نمی‌دهد.</p>
            {copySources.length > 0 && <label>کپی مواد از دستور فعال<select value={copyFrom} onChange={(event) => setCopyFrom(event.target.value)}><option value="">شروع خالی</option>{copySources.map((source) => <option key={source.recipeId} value={source.recipeId!}>{labelOf(source)}</option>)}</select></label>}
            {canManage && <button className="inventory-primary" disabled={busy}>{copyFrom ? "کپی و ویرایش پیش‌نویس" : "ساخت پیش‌نویس"}</button>}
          </form> : null;
        })() : recipe ? <>
          <div className="recipe-detail-heading"><div><h2>{labelOf(recipe)}</h2><p>{recipe.menuItemDeletedAt ? "این آیتم از منو بایگانی شده است؛ تاریخچه حفظ می‌شود." : "تغییرات دستور فقط بر نسخه‌های آینده اثر می‌گذارد."}</p></div>
            {canManage && recipe.versions.some((version) => version.status === "ACTIVE") && !recipe.versions.some((version) => version.status === "DRAFT") && <button className="inventory-secondary" disabled={busy} onClick={() => void newVersion()}>＋ نسخه جدید</button>}
          </div>
          <div className="recipe-history" aria-label="تاریخچه نسخه‌ها">{recipe.versions.map((version) => <button type="button" key={version.id} aria-current={version.id === selectedVersion?.id ? "page" : undefined} onClick={() => selectVersion(version)}><strong>v{fa(version.versionNumber)}</strong><span>{statusNames[version.status]}</span><small>{new Date(version.effectiveFrom ?? version.createdAt).toLocaleDateString("fa-IR")}</small></button>)}</div>
          {selectedVersion && <>
            <div className="recipe-version-heading"><h3>نسخه {fa(selectedVersion.versionNumber)} · {statusNames[selectedVersion.status]}</h3><small>{selectedVersion.effectiveFrom ? `مؤثر از ${new Date(selectedVersion.effectiveFrom).toLocaleString("fa-IR")}` : `پیش‌نویس ایجادشده در ${new Date(selectedVersion.createdAt).toLocaleDateString("fa-IR")}`}</small></div>
            {selectedVersion.status === "DRAFT" && canManage ? <div className="recipe-draft-lines">{draft.map((line, index) => {
              const item = ingredients.find((ingredient) => ingredient.id === line.inventoryItemId);
              const available = ingredients.filter((ingredient) => (ingredient.isActive || ingredient.id === line.inventoryItemId) && (ingredient.id === line.inventoryItemId || !draft.some((row, rowIndex) => rowIndex !== index && row.inventoryItemId === ingredient.id)));
              return <div className="recipe-draft-line" key={`${line.inventoryItemId}:${index}`}>
                <select
                  aria-label="کالای انبار"
                  value={line.inventoryItemId}
                  onChange={(event) => {
                    const next = ingredients.find((ingredient) => ingredient.id === event.target.value);
                    setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, inventoryItemId: event.target.value, unit: next?.baseUnit ?? "" } : row));
                  }}
                  required
                >
                  <option value="">انتخاب ماده</option>
                  {available.map((ingredient) => (
                    <option key={ingredient.id} value={ingredient.id}>
                      {ingredient.name}{ingredient.isActive ? "" : " · غیرفعال"} · {units[ingredient.baseUnit] ?? ingredient.baseUnit}
                    </option>
                  ))}
                </select>
                <input aria-label="مقدار" inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,6})?" placeholder="مقدار" value={line.quantity} onChange={(event) => setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} required />
                <select aria-label="واحد" value={line.unit} onChange={(event) => setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, unit: event.target.value } : row))} disabled={!item}>{item ? unitsFor(item).map((unit) => <option key={unit} value={unit}>{units[unit] ?? unit}</option>) : <option value="">واحد</option>}</select>
                <input aria-label="یادداشت اختیاری" placeholder="یادداشت" maxLength={240} value={line.note} onChange={(event) => setDraft((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, note: event.target.value } : row))} />
                <button type="button" className="recipe-remove" aria-label="حذف ماده" onClick={() => setDraft((rows) => rows.filter((_, rowIndex) => rowIndex !== index))}>×</button>
                {item && <small className="recipe-normalized">مقدار پایه: {line.quantity ? `${line.quantity} ${units[line.unit] ?? line.unit}` : "—"} · مبنا: {units[item.baseUnit] ?? item.baseUnit}</small>}
              </div>;
            })}
              <button type="button" className="inventory-secondary" disabled={!ingredients.length} onClick={() => setDraft((rows) => [...rows, { inventoryItemId: "", quantity: "1", unit: "", note: "" }])}>＋ افزودن ماده</button>
            </div> : <div className="inventory-table-scroll recipe-components"><table className="inventory-table"><thead><tr><th>ماده</th><th>مقدار دستور</th><th>مقدار پایه</th><th>یادداشت</th></tr></thead><tbody>{selectedVersion.components.map((component) => <tr key={component.id}><td><strong>{component.inventoryItemName}</strong>{!component.itemActive && <small>غیرفعال · محفوظ در تاریخچه</small>}</td><td>{component.quantity} {units[component.unit] ?? component.unit}</td><td>{component.quantityBase} {units[component.baseUnit] ?? component.baseUnit}</td><td>{component.note || "—"}</td></tr>)}{!selectedVersion.components.length && <tr><td colSpan={4}>این نسخه هنوز ماده‌ای ندارد.</td></tr>}</tbody></table></div>}
            {selectedVersion.status === "DRAFT" && canManage && <div className="inventory-actions"><button type="button" className="inventory-secondary" disabled={busy} onClick={() => void saveDraft()}>ذخیره پیش‌نویس</button><button type="button" className="inventory-primary" disabled={busy || !draft.length} onClick={() => void publishDraft()}>انتشار نسخه</button></div>}
            <RecipeCostSummary cost={cost} busy={costBusy} error={costError} draftHasChanges={Boolean(draftHasChanges)} />
          </>}
        </> : <div className="recipe-empty-state"><h2>یک آیتم منو را انتخاب کنید</h2><p>برای هر آیتم می‌توانید نسخه‌های اختیاری و مستقل تعریف کنید.</p><Link href="/admin/menu">رفتن به مدیریت منو</Link></div>}
      </section>
    </div>
    {busy && <p className="inventory-loading" role="status">در حال ذخیره یا دریافت اطلاعات…</p>}
  </section>;
}

function RecipeCostSummary({ cost, busy, error, draftHasChanges }: { cost: CostSummary | null; busy: boolean; error: string; draftHasChanges: boolean }) {
  if (busy) return <section className="recipe-cost-summary"><h3>هزینه فعلی رسپی</h3><p className="inventory-loading" role="status">در حال محاسبه هزینه مواد…</p></section>;
  if (error) return <section className="recipe-cost-summary"><h3>هزینه فعلی رسپی</h3><p className="inventory-alert" role="alert">{error}</p></section>;
  if (!cost) return null;
  return <section className="recipe-cost-summary">
    <div className="cost-breakdown-heading"><div><h3>{cost.recipeVersionStatus === "SUPERSEDED" ? "برآورد امروز برای نسخه پیشین" : "هزینه فعلی رسپی"}</h3><p>{cost.costLocation ? `میانگین هزینه محل پیش‌فرض: ${cost.costLocation.name}` : "محل پیش‌فرض برای ثبت میانگین هزینه موجود نیست."}</p></div><b className={`recipe-status costing-status costing-${cost.costStatus.toLowerCase()}`}>{cost.costStatus === "COMPLETE" ? "هزینه کامل" : cost.costStatus === "NO_COST_DATA" ? "هزینه ثبت نشده" : "هزینه ناقص"}</b></div>
    {draftHasChanges && <p className="costing-hint">این برآورد برای آخرین نسخه ذخیره‌شده است؛ پس از ذخیره پیش‌نویس به‌روز می‌شود.</p>}
    {cost.recipeVersionStatus === "SUPERSEDED" && <p className="costing-hint">قیمت‌های فعلی جایگزین هزینه تاریخی این نسخه نمی‌شوند.</p>}
    {cost.inactiveComponentCount > 0 && <p className="costing-warning">این رسپی {fa(cost.inactiveComponentCount)} کالای غیرفعال دارد؛ در محاسبه حذف نشده‌اند.</p>}
    <div className="cost-breakdown-table"><div className="cost-breakdown-head"><span>ماده و مقدار</span><span>میانگین هر واحد پایه</span><span>هزینه جزء</span></div>
      {cost.components.map((component) => <div className="cost-breakdown-line" key={component.recipeComponentId}><span><strong>{component.inventoryItemName}{!component.itemActive ? " · غیرفعال" : ""}</strong><small>{component.quantity} {units[component.unit] ?? component.unit} · پایه {component.normalizedQuantity} {units[component.normalizedUnit] ?? component.normalizedUnit}</small></span><span>{component.costAvailable ? `${toman(component.normalizedUnitCostToman)} / ${units[component.normalizedUnit] ?? component.normalizedUnit}` : "هزینه ثبت نشده"}</span><span>{component.costAvailable ? toman(component.componentCostToman) : "نامشخص"}</span></div>)}
      {!cost.components.length && <p className="recipe-empty">این نسخه هنوز ماده‌ای ندارد.</p>}
    </div>
    {cost.costStatus !== "COMPLETE" && cost.totalKnownCostToman !== null && <p className="costing-hint">جمع هزینه‌های مشخص (ناقص): {toman(cost.totalKnownCostToman)}</p>}
    {cost.missingCostItems.length > 0 && <p className="costing-missing-summary">برای تکمیل محاسبه، هزینه {cost.missingCostItems.map((item) => item.inventoryItemName).join("، ")} را از طریق رسید خرید ثبت کنید.</p>}
    <div className="cost-breakdown-total"><strong>{cost.costStatus === "COMPLETE" ? `بهای رسپی: ${toman(cost.recipeCostToman)}` : "بهای رسپی کامل نیست"}</strong>{cost.costStatus === "COMPLETE" && <span>قیمت فروش {toman(cost.sellingPriceToman)} · سود ناخالص {toman(cost.grossProfitToman)} · حاشیه {percent(cost.grossMarginPercent)} · بهای مواد {percent(cost.materialCostPercent)}</span>}</div>
    <small className="costing-footnote">محاسبه بر مبنای میانگین فعلی محل پیش‌فرض است و هزینه‌های عملیاتی را شامل نمی‌شود.</small>
  </section>;
}
