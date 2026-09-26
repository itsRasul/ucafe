"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { PlatformApi as Api, usePlatformSession } from "../use-platform-session";
import { CrmCriteriaSummary, CrmFilterBuilder, FilterDefinition, initialFilter, isFilterReady } from "./metadata-controls";
import { CrmWorkspaceShell } from "./leads/workspace";

type Rule = { id: string; name: string; description: string | null; category: "FIT" | "ENGAGEMENT"; criteria: FilterDefinition; points: number; enabled: boolean; sortOrder: number; criteriaValid: boolean; warning: string | null };
type Draft = { name: string; description: string; category: "FIT" | "ENGAGEMENT"; points: string; enabled: boolean; sortOrder: string; criteria: FilterDefinition };
const emptyDraft = (): Draft => ({ name: "", description: "", category: "FIT", points: "10", enabled: true, sortOrder: "0", criteria: initialFilter() });
const categoryNames = { FIT: "تناسب", ENGAGEMENT: "تعامل" };
const forbiddenScoreFields = ["fitScore", "engagementScore", "overallScore", "scoreCalculatedAt"];

export function CrmScoringPage() {
  const { state, access, api } = usePlatformSession();
  if (state === "loading") return <main className="platform-entry"><p>در حال بررسی دسترسی…</p></main>;
  if (state !== "ready" || !access.includes("crm.read")) return <main className="platform-entry"><section><h1>دسترسی CRM فعال نیست</h1><p>برای مشاهده قواعد امتیازدهی به دسترسی crm.read نیاز دارید.</p><Link className="crm-button" href="/platform/crm/leads">بازگشت به سرنخ‌ها</Link></section></main>;
  return <CrmWorkspaceShell canManage={access.includes("crm.manage")}><ScoringRules api={api} canManage={access.includes("crm.manage")} /></CrmWorkspaceShell>;
}

function ScoringRules({ api, canManage }: { api: Api; canManage: boolean }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [selected, setSelected] = useState("");
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [archiveId, setArchiveId] = useState("");
  async function load() {
    try { setRules(await api<Rule[]>("/platform/crm/scoring/rules")); setError(""); }
    catch (reason) { setError((reason as Error).message); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [api]);
  function reset() { setSelected(""); setDraft(emptyDraft()); setPreviewCount(null); setError(""); }
  function edit(rule: Rule) {
    setSelected(rule.id); setDraft({ name: rule.name, description: rule.description ?? "", category: rule.category, points: String(rule.points), enabled: rule.enabled, sortOrder: String(rule.sortOrder), criteria: rule.criteria }); setPreviewCount(null); setError("");
  }
  async function preview() {
    setBusy(true); setError("");
    try { const result = await api<{ matchCount: number }>("/platform/crm/scoring/rules/preview", { method: "POST", body: JSON.stringify({ category: draft.category, criteria: draft.criteria }) }); setPreviewCount(result.matchCount); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const body = JSON.stringify({ name: draft.name, description: draft.description || null, category: draft.category, criteria: draft.criteria, points: Number(draft.points), enabled: draft.enabled, sortOrder: Number(draft.sortOrder) });
      await api(selected ? `/platform/crm/scoring/rules/${selected}` : "/platform/crm/scoring/rules", { method: selected ? "PATCH" : "POST", body });
      await load(); reset();
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function setEnabled(rule: Rule) {
    setBusy(true); setError("");
    try { await api(`/platform/crm/scoring/rules/${rule.id}`, { method: "PATCH", body: JSON.stringify({ enabled: !rule.enabled }) }); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  async function archive(id: string) {
    setBusy(true); setError("");
    try { await api(`/platform/crm/scoring/rules/${id}/archive`, { method: "POST" }); if (selected === id) reset(); setArchiveId(""); await load(); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }
  const ready = draft.name.trim() && draft.criteria.conditions.length > 0 && isFilterReady(draft.criteria) && Number.isInteger(Number(draft.points)) && Number(draft.points) >= -100 && Number(draft.points) <= 100;
  return <>
    <header className="crm-heading"><div><p className="platform-nav-label">پلتفرم / CRM</p><h1>امتیازدهی سرنخ‌ها</h1><p>قواعد شفاف و قابل ویرایش برای سنجش تناسب و تعامل.</p></div><Link className="crm-button crm-secondary-link" href="/platform/crm/leads">بازگشت به سرنخ‌ها</Link></header>
    <section className="crm-lead-panel crm-scoring-intro"><h2>روش محاسبه</h2><p>هر قاعده منطبق، امتیاز خودش را به دسته تناسب یا تعامل می‌افزاید. هر دسته بین ۰ تا ۱۰۰ محدود می‌شود و امتیاز کل میانگین برابر دو دسته است.</p><p>قواعد بر اساس داده‌های سرنخ، برچسب‌ها، فیلدهای سفارشی و تعامل‌های ثبت‌شده اجرا می‌شوند. امتیاز، احتمال فروش نیست و اولویت دستی را تغییر نمی‌دهد.</p><Link href="/platform/crm/settings">مدیریت فیلدها و برچسب‌ها</Link></section>
    {error && <p className="message error" role="alert">{error}</p>}
    {canManage && <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>{selected ? "ویرایش قاعده" : "قاعده جدید"}</h2><p>از همان شرط‌های فیلتر سرنخ استفاده کنید؛ امتیاز هر قاعده باید بین ۱۰۰- و ۱۰۰ باشد.</p></div></header>
      <form className="crm-scoring-form" onSubmit={(event) => void save(event)}>
        <div className="crm-meta-form"><label>نام قاعده<input required maxLength={120} value={draft.name} onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setPreviewCount(null); }} /></label><label>دسته<select value={draft.category} onChange={(event) => { setDraft({ ...draft, category: event.target.value as Draft["category"] }); setPreviewCount(null); }}><option value="FIT">تناسب</option><option value="ENGAGEMENT">تعامل</option></select></label><label>امتیاز<input type="number" required min={-100} max={100} step={1} inputMode="numeric" value={draft.points} onChange={(event) => setDraft({ ...draft, points: event.target.value })} /></label><label>ترتیب نمایش<input type="number" min={0} max={10000} step={1} value={draft.sortOrder} onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })} /></label><label className="crm-meta-wide">توضیح اختیاری<input maxLength={500} value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} /></label><label className="crm-score-enabled"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} /> قاعده فعال باشد</label></div>
        <CrmFilterBuilder api={api} entityType="LEAD" value={draft.criteria} onChange={(criteria) => { setDraft({ ...draft, criteria }); setPreviewCount(null); }} excludeFields={forbiddenScoreFields} heading="شرط قاعده" description="از ۱ تا ۲۰ شرط پشتیبانی می‌شود؛ شرط‌ها با و یا یا ترکیب می‌شوند." />
        {previewCount !== null && <p className="crm-score-preview" role="status">این قاعده اکنون با {new Intl.NumberFormat("fa-IR").format(previewCount)} سرنخ فعال منطبق است.</p>}
        <div className="crm-form-actions"><button type="button" className="crm-secondary" disabled={busy || !draft.criteria.conditions.length || !isFilterReady(draft.criteria)} onClick={() => void preview()}>{busy ? "در حال بررسی…" : "پیش‌نمایش تعداد"}</button><button disabled={busy || !ready}>{busy ? "در حال ذخیره…" : selected ? "ذخیره تغییرات" : "افزودن قاعده"}</button>{selected && <button type="button" className="crm-secondary" disabled={busy} onClick={reset}>انصراف</button>}</div>
      </form>
    </section>}
    <section className="crm-lead-panel"><header className="crm-section-heading"><div><h2>قواعد ثبت‌شده</h2><p>تغییر قاعده باعث محاسبه دوباره سرنخ‌های فعال می‌شود.</p></div></header>
      {loading ? <p className="empty" role="status">در حال دریافت قواعد…</p> : rules.length ? <ul className="crm-meta-list crm-scoring-rules">{rules.map((rule) => <li key={rule.id}><div className="crm-scoring-rule-main"><strong>{rule.name}</strong><span className={`crm-score-rule-status ${rule.enabled && rule.criteriaValid ? "is-active" : ""}`}>{rule.enabled ? rule.criteriaValid ? "فعال" : "نیازمند اصلاح" : "غیرفعال"}</span><small>{categoryNames[rule.category]} · امتیاز {rule.points > 0 ? `+${rule.points}` : rule.points}</small>{rule.description && <p>{rule.description}</p>}<CrmCriteriaSummary api={api} entityType="LEAD" filter={rule.criteria} />{rule.warning && <small className="crm-filter-incomplete">این قاعده به فیلد یا برچسب غیرفعال اشاره می‌کند و در امتیاز محاسبه نمی‌شود.</small>}</div>{canManage && <div className="crm-actions">{archiveId === rule.id ? <><span>قاعده بایگانی شود؟</span><button type="button" className="crm-danger" disabled={busy} onClick={() => void archive(rule.id)}>تأیید بایگانی</button><button type="button" className="crm-secondary" onClick={() => setArchiveId("")}>انصراف</button></> : <><button type="button" className="crm-secondary" disabled={busy} onClick={() => edit(rule)}>ویرایش</button><button type="button" className="crm-secondary" disabled={busy} onClick={() => void setEnabled(rule)}>{rule.enabled ? "غیرفعال‌کردن" : "فعال‌کردن"}</button><button type="button" className="crm-danger" disabled={busy} onClick={() => setArchiveId(rule.id)}>بایگانی</button></>}</div>}</li>)}</ul> : <p className="empty crm-empty">هنوز قاعده‌ای تعریف نشده است. امتیاز سرنخ‌ها تا زمان افزودن قاعده «تنظیم‌نشده» نمایش داده می‌شود.</p>}
    </section>
  </>;
}
