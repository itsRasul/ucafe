"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useAdminSession } from "../admin-session";

type RewardType = "PERCENTAGE" | "FIXED_AMOUNT" | "FIXED_PRICE";
type Target = { type: "PRODUCT" | "CATEGORY"; id: string; name: string | null };
type Promotion = { id: string; name: string; description: string | null; isActive: boolean; status: string; startAt: string | null; endAt: string | null; priority: number; rewardType: RewardType; rewardValue: string; targets: Target[] };
type MenuItem = { id: string; name: string; isAvailable: boolean };
type Category = { id: string; name: string; isActive: boolean; items: MenuItem[] };
type FormState = { id?: string; name: string; description: string; rewardType: RewardType; rewardValue: string; priority: number; startAt: string; endAt: string; isActive: boolean; targetKeys: string[] };

const emptyForm = (): FormState => ({ name: "", description: "", rewardType: "PERCENTAGE", rewardValue: "20", priority: 0, startAt: "", endAt: "", isActive: false, targetKeys: [] });
const rewardNames: Record<RewardType, string> = { PERCENTAGE: "درصدی", FIXED_AMOUNT: "مبلغ ثابت", FIXED_PRICE: "قیمت ویژه" };
const statusNames: Record<string, string> = { INACTIVE: "غیرفعال", UPCOMING: "در انتظار شروع", RUNNING: "در حال اجرا", EXPIRED: "پایان‌یافته", ARCHIVED: "بایگانی‌شده" };
const toman = new Intl.NumberFormat("fa-IR");

function toLocalInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function fromLocalInput(value: string) { return value ? new Date(value).toISOString() : null; }
function localTime(value: string | null) { return value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "بدون محدودیت"; }
function targetKey(target: Pick<Target, "type" | "id">) { return `${target.type}:${target.id}`; }

export function PromotionsAdmin() {
  const { access, api } = useAdminSession();
  const canRead = access.permissions.includes("menu.read") || access.permissions.includes("menu.manage");
  const canManage = access.permissions.includes("menu.manage");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const timeZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "منطقه زمانی دستگاه", []);

  const load = useCallback(async () => {
    const [rows, menu] = await Promise.all([api<Promotion[]>("/tenant/promotions"), api<Category[]>("/tenant/menu")]);
    setPromotions(rows);
    setCategories(menu);
  }, [api]);

  useEffect(() => {
    if (!canRead) { setLoading(false); return; }
    load().catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, [canRead, load]);

  function edit(promotion?: Promotion) {
    setError(""); setNotice("");
    setForm(promotion ? {
      id: promotion.id, name: promotion.name, description: promotion.description ?? "", rewardType: promotion.rewardType,
      rewardValue: promotion.rewardValue, priority: promotion.priority, startAt: toLocalInput(promotion.startAt), endAt: toLocalInput(promotion.endAt),
      isActive: promotion.isActive, targetKeys: promotion.targets.map(targetKey),
    } : emptyForm());
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const targets = form.targetKeys.map((key) => { const [type, id] = key.split(":"); return type === "PRODUCT" ? { menuItemId: id } : { categoryId: id }; });
      await api(form.id ? `/tenant/promotions/${form.id}` : "/tenant/promotions", {
        method: form.id ? "PATCH" : "POST",
        body: JSON.stringify({ name: form.name.trim(), description: form.description.trim() || null, rewardType: form.rewardType, rewardValue: Number(form.rewardValue), priority: Number(form.priority), startAt: fromLocalInput(form.startAt), endAt: fromLocalInput(form.endAt), targets, ...(!form.id ? { isActive: form.isActive } : {}) }),
      });
      await load(); setForm(null); setNotice(form.id ? "تخفیف ویرایش شد." : "تخفیف ساخته شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function run(id: string, action: "activate" | "deactivate" | "archive") {
    if (action === "archive" && !confirm("این تخفیف بایگانی شود؟ سفارش‌های قبلی همچنان اطلاعات مالی خود را حفظ می‌کنند.")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/promotions/${id}${action === "archive" ? "" : `/${action}`}`, { method: action === "archive" ? "DELETE" : "POST" });
      await load(); setNotice(action === "archive" ? "تخفیف بایگانی شد." : action === "activate" ? "تخفیف فعال شد." : "تخفیف غیرفعال شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  function toggleTarget(key: string) {
    if (!form) return;
    setForm({ ...form, targetKeys: form.targetKeys.includes(key) ? form.targetKeys.filter((current) => current !== key) : [...form.targetKeys, key] });
  }

  if (!canRead) return <section className="admin-section-state"><p className="eyebrow">دسترسی محدود</p><h1>تخفیف‌ها</h1><p>نقش شما اجازه مشاهده تخفیف‌ها را ندارد.</p></section>;

  return <section className="admin-promotions" aria-labelledby="promotions-title">
    <header className="admin-page-heading"><div><p className="eyebrow">منو و قیمت‌گذاری</p><h1 id="promotions-title">تخفیف‌ها</h1><p>برای محصولات یا دسته‌بندی‌های منو، قیمت ویژه تعریف کنید.</p></div>{canManage && !form && <button type="button" onClick={() => edit()}>ایجاد تخفیف</button>}</header>
    {error && <p className="admin-message error" role="alert">{error}</p>}{notice && <p className="admin-message success" role="status">{notice}</p>}
    {form && <form className="promotion-form" onSubmit={(event) => void save(event)}>
      <div className="promotion-form-heading"><div><h2>{form.id ? "ویرایش تخفیف" : "تخفیف جدید"}</h2><p>قیمت منوی اصلی پس از پایان تخفیف به شکل خودکار باقی می‌ماند.</p></div><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>بستن</button></div>
      <div className="promotion-form-grid">
        <label>نام تخفیف<input value={form.name} maxLength={120} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label>نوع تخفیف<select value={form.rewardType} onChange={(event) => setForm({ ...form, rewardType: event.target.value as RewardType })}>{Object.entries(rewardNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>{form.rewardType === "PERCENTAGE" ? "درصد تخفیف" : form.rewardType === "FIXED_AMOUNT" ? "مبلغ تخفیف (تومان)" : "قیمت ویژه (تومان)"}<input type="number" min={form.rewardType === "FIXED_PRICE" ? 0 : 1} max={form.rewardType === "PERCENTAGE" ? 100 : Number.MAX_SAFE_INTEGER} step={1} required value={form.rewardValue} onChange={(event) => setForm({ ...form, rewardValue: event.target.value })} /></label>
        <label>اولویت در تخفیف‌های هم‌مقدار<input type="number" min={0} max={1000000} step={1} value={form.priority} onChange={(event) => setForm({ ...form, priority: Number(event.target.value) })} /></label>
        <label className="promotion-wide">توضیحات <small>اختیاری</small><textarea maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
        <label>شروع <small>به وقت {timeZone}</small><input type="datetime-local" value={form.startAt} onChange={(event) => setForm({ ...form, startAt: event.target.value })} /></label>
        <label>پایان <small>به وقت {timeZone}</small><input type="datetime-local" value={form.endAt} onChange={(event) => setForm({ ...form, endAt: event.target.value })} /></label>
      </div>
      <fieldset className="promotion-targets"><legend>اعمال روی محصولات یا دسته‌بندی‌ها</legend>{categories.map((category) => <div className="promotion-target-group" key={category.id}><label className="promotion-target-option"><input type="checkbox" checked={form.targetKeys.includes(`CATEGORY:${category.id}`)} onChange={() => toggleTarget(`CATEGORY:${category.id}`)} /><strong>دسته‌بندی: {category.name}</strong></label>{category.items.map((item) => <label className="promotion-target-option promotion-product-option" key={item.id}><input type="checkbox" checked={form.targetKeys.includes(`PRODUCT:${item.id}`)} onChange={() => toggleTarget(`PRODUCT:${item.id}`)} /><span>{item.name}{!item.isAvailable && <small> · ناموجود</small>}</span></label>)}</div>)}</fieldset>
      {!categories.length && <p className="admin-message error">ابتدا برای منو دسته‌بندی و محصول بسازید.</p>}
      {!form.id && <label className="promotion-activate"><input type="checkbox" checked={form.isActive} onChange={(event) => setForm({ ...form, isActive: event.target.checked })} />از همین حالا فعال باشد</label>}
      <div className="promotion-form-actions"><button disabled={busy || !canManage || !form.targetKeys.length}>{busy ? "در حال ذخیره…" : "ذخیره تخفیف"}</button><button type="button" className="promotion-cancel" onClick={() => setForm(null)}>انصراف</button></div>
    </form>}
    {loading ? <p className="admin-inline-loading" role="status">در حال دریافت تخفیف‌ها…</p> : promotions.length ? <div className="promotion-list">{promotions.map((promotion) => <article className="promotion-card" key={promotion.id}><div className="promotion-card-heading"><div><h2>{promotion.name}</h2>{promotion.description && <p>{promotion.description}</p>}</div><span className={`promotion-status promotion-status-${promotion.status.toLowerCase()}`}>{statusNames[promotion.status] ?? promotion.status}</span></div><dl><div><dt>نوع</dt><dd>{rewardNames[promotion.rewardType]}</dd></div><div><dt>مقدار</dt><dd>{promotion.rewardType === "PERCENTAGE" ? `${toman.format(Number(promotion.rewardValue))}٪` : `${toman.format(Number(promotion.rewardValue))} تومان`}</dd></div><div><dt>اولویت</dt><dd>{toman.format(promotion.priority)}</dd></div><div><dt>شروع</dt><dd>{localTime(promotion.startAt)}</dd></div><div><dt>پایان</dt><dd>{localTime(promotion.endAt)}</dd></div><div className="promotion-target-summary"><dt>اهداف</dt><dd>{promotion.targets.map((target) => `${target.type === "CATEGORY" ? "دسته" : "محصول"}: ${target.name ?? "حذف‌شده"}`).join("، ")}</dd></div></dl><div className="promotion-card-actions">{canManage && promotion.status !== "ARCHIVED" && <><button type="button" className="promotion-secondary" onClick={() => edit(promotion)}>ویرایش</button>{promotion.isActive ? <button type="button" className="promotion-secondary" disabled={busy} onClick={() => void run(promotion.id, "deactivate")}>غیرفعال‌سازی</button> : <button type="button" disabled={busy} onClick={() => void run(promotion.id, "activate")}>فعال‌سازی</button>}<button type="button" className="promotion-danger" disabled={busy} onClick={() => void run(promotion.id, "archive")}>بایگانی</button></>}</div></article>)}</div> : <div className="admin-empty"><strong>هنوز تخفیفی نساخته‌اید</strong><p>محصول یا دسته‌بندی موردنظر را انتخاب و قیمت تخفیف‌دار را مشخص کنید.</p></div>}
  </section>;
}
