"use client";

import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type { PlatformApi } from "./use-platform-session";

type Plan = {
  id: string; key: string; name: string; description: string; status: "ACTIVE" | "POSTPONED" | "ARCHIVED";
  priceToman: string; sortOrder: number; billingMonths: number; trialDays: number; graceDays: number;
  highlightedFeatureKeys: string[];
  features: { menu?: boolean; reservations?: boolean; onlineOrdering?: boolean; analytics?: boolean; tenant_crm?: boolean; inventory?: boolean };
};
type FeatureDefinition = { id: string; key: string; label: string; sortOrder: number };
type FeatureValue = { planId: string; planKey: string; featureId: string; key: string; label: string; value: string; sortOrder: number };
type FeatureCatalog = { definitions: FeatureDefinition[]; values: FeatureValue[] };
type Props = { items: Plan[]; api: PlatformApi; reload: () => Promise<void>; note: (value: string) => void; fail: (value: string) => void };

const functionalFeatures: Array<[keyof Plan["features"], string]> = [
  ["menu", "منو"], ["reservations", "رزرو میز"], ["onlineOrdering", "سفارش‌گیری"],
  ["analytics", "تحلیل و آمار فروش"], ["tenant_crm", "CRM"], ["inventory", "انبارداری"],
];

export function Plans({ items, api, reload, note, fail }: Props) {
  const [drafts, setDrafts] = useState<Record<string, Plan>>({});
  const [display, setDisplay] = useState<FeatureCatalog>({ definitions: [], values: [] });
  const [newLabel, setNewLabel] = useState("");
  const [newOrder, setNewOrder] = useState(10);
  const [loadingDisplay, setLoadingDisplay] = useState(true);

  useEffect(() => setDrafts(Object.fromEntries(items.map((plan) => [plan.key, { ...plan, highlightedFeatureKeys: [...(plan.highlightedFeatureKeys ?? [])], features: { ...(plan.features ?? {}) } }]))), [items]);

  async function loadDisplay() {
    setLoadingDisplay(true);
    try { setDisplay(await api<FeatureCatalog>("/platform/plans/display-features")); }
    catch (error) { fail((error as Error).message); }
    finally { setLoadingDisplay(false); }
  }
  useEffect(() => { void loadDisplay(); }, [api]);

  function editPlan(key: string, update: Partial<Plan>) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key]!, ...update } }));
  }

  async function savePlan(plan: Plan) {
    try {
      await api(`/platform/plans/${plan.key}`, { method: "PATCH", body: JSON.stringify({
        name: plan.name, description: plan.description, priceToman: Number(plan.priceToman), sortOrder: plan.sortOrder,
        billingMonths: plan.billingMonths, status: plan.status, trialDays: plan.trialDays, graceDays: plan.graceDays,
        highlightedFeatureKeys: plan.highlightedFeatureKeys,
        features: Object.fromEntries(functionalFeatures.map(([key]) => [key, Boolean(plan.features[key])])),
      }) });
      await reload(); note("پلن ذخیره شد.");
    } catch (error) { fail((error as Error).message); }
  }

  async function addDefinition(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      await api("/platform/plans/display-features", { method: "POST", body: JSON.stringify({ label: newLabel, sortOrder: newOrder }) });
      setNewLabel(""); await loadDisplay(); note("ویژگی نمایشی اضافه شد.");
    } catch (error) { fail((error as Error).message); }
  }

  async function updateDefinition(feature: FeatureDefinition) {
    try {
      await api(`/platform/plans/display-features/${feature.id}`, { method: "PATCH", body: JSON.stringify({ label: feature.label, sortOrder: feature.sortOrder }) });
      await loadDisplay(); note("تعریف و ترتیب مشترک ذخیره شد.");
    } catch (error) { fail((error as Error).message); }
  }

  async function deleteDefinition(feature: FeatureDefinition) {
    if (!window.confirm(`تعریف «${feature.label}» و مقدارهای آن در همه پلن‌ها حذف شود؟`)) return;
    try {
      await api(`/platform/plans/display-features/${feature.id}`, { method: "DELETE" });
      await loadDisplay(); note("تعریف ویژگی نمایشی حذف شد.");
    } catch (error) { fail((error as Error).message); }
  }

  const orderedDefinitions = useMemo(() => [...display.definitions].sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key)), [display.definitions]);

  return <div className="platform-plan-editor">
    <section className="display-feature-admin" aria-labelledby="display-features-title">
      <header><div><h2 id="display-features-title">ویژگی‌های نمایشی و مقایسه‌ای</h2><p>این موارد فقط در معرفی پلن‌ها نمایش داده می‌شوند و دسترسی سیستمی ایجاد نمی‌کنند.</p></div></header>
      <form className="display-feature-create" onSubmit={addDefinition}>
        <label>عنوان مشترک<input value={newLabel} maxLength={100} required onChange={(event) => setNewLabel(event.target.value)} placeholder="مثلاً پشتیبانی" /></label>
        <label>ترتیب نمایش<input type="number" min="0" max="32000" value={newOrder} required onChange={(event) => setNewOrder(Number(event.target.value))} /></label>
        <button type="submit">افزودن ویژگی نمایشی</button>
      </form>
      {loadingDisplay ? <p role="status">در حال دریافت ویژگی‌های نمایشی…</p> : orderedDefinitions.length ? <div className="display-feature-definitions">{orderedDefinitions.map((feature) => <DefinitionEditor key={feature.id} initial={feature} onSave={updateDefinition} onDelete={deleteDefinition} />)}</div> : <p className="empty">هنوز ویژگی نمایشی تعریف نشده است.</p>}
      <small>تغییر عنوان یا ترتیب در همه پلن‌های متصل به این ویژگی اعمال می‌شود. ترتیب‌های یکسان با کلید پایدار ویژگی مرتب می‌شوند.</small>
    </section>

    <div className="cards">{Object.values(drafts).map((plan) => <article className="form platform-plan-card" key={plan.id}>
      <h2>{plan.name || plan.key}</h2>
      <label>نام<input value={plan.name} onChange={(event) => editPlan(plan.key, { name: event.target.value })} /></label>
      <label>توضیح کوتاه<textarea value={plan.description} maxLength={500} onChange={(event) => editPlan(plan.key, { description: event.target.value })} /></label>
      <label>قیمت تومان<input type="number" min="0" value={plan.priceToman} onChange={(event) => editPlan(plan.key, { priceToman: event.target.value })} /></label>
      <label>ترتیب پلن<input type="number" min="0" value={plan.sortOrder} onChange={(event) => editPlan(plan.key, { sortOrder: Number(event.target.value) })} /><small>عدد بزرگ‌تر یعنی پلن بالاتر.</small></label>
      <label>مدت صورتحساب (ماه)<input type="number" min="1" max="12" value={plan.billingMonths} onChange={(event) => editPlan(plan.key, { billingMonths: Number(event.target.value) })} /></label>
      <label>وضعیت<select value={plan.status} onChange={(event) => editPlan(plan.key, { status: event.target.value as Plan["status"] })}><option value="ACTIVE">فعال</option><option value="POSTPONED">به‌تعویق‌افتاده</option><option value="ARCHIVED">بایگانی</option></select></label>
      <fieldset className="plan-modules functional-plan-features"><legend>ویژگی‌های کاربردی</legend><p>این موارد دسترسی واقعی پلن به ماژول‌های یوکافه را کنترل می‌کنند.</p>{functionalFeatures.map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(plan.features[key])} onChange={(event) => editPlan(plan.key, { features: { ...plan.features, [key]: event.target.checked } })} />{label}</label>)}</fieldset>
      <PlanDisplayAssignments planKey={plan.key} definitions={orderedDefinitions} values={display.values.filter((item) => item.planKey === plan.key)} api={api} reload={loadDisplay} note={note} fail={fail} />
      <button type="button" onClick={() => void savePlan(plan)}>ذخیره پلن</button>
    </article>)}</div>
  </div>;
}

function DefinitionEditor({ initial, onSave, onDelete }: { initial: FeatureDefinition; onSave: (feature: FeatureDefinition) => void; onDelete: (feature: FeatureDefinition) => void }) {
  const [feature, setFeature] = useState(initial);
  useEffect(() => setFeature(initial), [initial]);
  return <div className="display-feature-definition">
    <label>عنوان<input value={feature.label} maxLength={100} required onChange={(event) => setFeature({ ...feature, label: event.target.value })} /></label>
    <label>ترتیب<input type="number" min="0" max="32000" value={feature.sortOrder} onChange={(event) => setFeature({ ...feature, sortOrder: Number(event.target.value) })} /></label>
    <button type="button" onClick={() => onSave(feature)}>ذخیره تعریف</button>
    <button type="button" className="danger" onClick={() => onDelete(feature)}>حذف تعریف و مقدارها</button>
  </div>;
}

function PlanDisplayAssignments({ planKey, definitions, values, api, reload, note, fail }: { planKey: string; definitions: FeatureDefinition[]; values: FeatureValue[]; api: PlatformApi; reload: () => Promise<void>; note: (value: string) => void; fail: (value: string) => void }) {
  const [draftValues, setDraftValues] = useState<Record<string, string>>({});
  const [featureId, setFeatureId] = useState("");
  const [newValue, setNewValue] = useState("");
  const assignedIds = new Set(values.map((value) => value.featureId));
  const available = definitions.filter((feature) => !assignedIds.has(feature.id));
  useEffect(() => setDraftValues(Object.fromEntries(values.map((item) => [item.featureId, item.value]))), [values]);

  async function setValue(id: string, value: string) {
    try {
      await api(`/platform/plans/${planKey}/display-features/${id}`, { method: "PUT", body: JSON.stringify({ value }) });
      await reload(); note("مقدار ویژگی نمایشی ذخیره شد.");
    } catch (error) { fail((error as Error).message); }
  }

  async function removeValue(id: string) {
    try {
      await api(`/platform/plans/${planKey}/display-features/${id}`, { method: "DELETE" });
      await reload(); note("ویژگی نمایشی از این پلن برداشته شد.");
    } catch (error) { fail((error as Error).message); }
  }

  async function addValue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!featureId) return;
    await setValue(featureId, newValue);
    setFeatureId(""); setNewValue("");
  }

  return <fieldset className="plan-display-features"><legend>ویژگی‌های نمایشی</legend><p>این موارد فقط برای معرفی و مقایسه‌اند؛ دسترسی سیستم را تغییر نمی‌دهند.</p>
    {values.map((feature) => <div className="plan-display-value" key={feature.featureId}><label>{feature.label}<input value={draftValues[feature.featureId] ?? feature.value} maxLength={160} required onChange={(event) => setDraftValues({ ...draftValues, [feature.featureId]: event.target.value })} /></label><button type="button" onClick={() => void setValue(feature.featureId, draftValues[feature.featureId] ?? feature.value)}>ذخیره مقدار</button><button type="button" className="danger" onClick={() => void removeValue(feature.featureId)}>حذف از پلن</button></div>)}
    <form className="plan-display-add" onSubmit={addValue}><label>ویژگی<select value={featureId} required onChange={(event) => setFeatureId(event.target.value)}><option value="">انتخاب تعریف مشترک</option>{available.map((feature) => <option key={feature.id} value={feature.id}>{feature.label}</option>)}</select></label><label>مقدار<input value={newValue} maxLength={160} required onChange={(event) => setNewValue(event.target.value)} placeholder="مثلاً ۲۴ ساعته" /></label><button type="submit" disabled={!available.length}>افزودن به این پلن</button></form>
  </fieldset>;
}
