"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";

type Page<T> = { items: T[]; total: number; page: number; pageSize: number };
type Segment = { id: string; name: string; isActive: boolean; criteriaValid: boolean };
type Promotion = { id: string; name: string; description: string | null; status: string; isActive: boolean; rewardType: string; rewardValue: string; startAt: string | null; endAt: string | null; coupon: { code: string; isActive: boolean } | null };
type Offer = { id: string; name: string; description: string | null; promotionId: string; segmentId: string; status: "DRAFT" | "ACTIVE" | "ENDED"; segmentName: string; segmentNameSnapshot: string | null; promotionName: string; promotionActive: boolean; promotionStartsAt: string | null; promotionEndsAt: string | null; audienceCount: number; redemptionCount: number; appliedOrderCount: number; activatedAt: string | null; endedAt: string | null };
type Client = { id: string; firstName: string; lastName: string; phone: string; grantedAt: string };
type Preview = { matchingClients: number; sample: Client[] };
type Form = { id?: string; name: string; description: string; promotionId: string; segmentId: string };

const number = new Intl.NumberFormat("fa-IR");
const dateLabel = (value: string | null, timeZone: string) => value ? new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeZone }).format(new Date(value)) : "بدون تاریخ محدودکننده";
const statusNames = { DRAFT: "پیش‌نویس", ACTIVE: "فعال", ENDED: "پایان‌یافته" };
const promotionStatusNames: Record<string, string> = { RUNNING: "فعال اکنون", UPCOMING: "در انتظار شروع", EXPIRED: "پایان‌یافته", INACTIVE: "غیرفعال", OUTSIDE_SCHEDULE: "خارج از زمان‌بندی", ARCHIVED: "بایگانی‌شده" };
const rewardNames: Record<string, string> = { PERCENTAGE: "درصدی", FIXED_AMOUNT: "مبلغ ثابت", FIXED_PRICE: "قیمت ویژه" };
const json = (method: string, body?: unknown): RequestInit => ({ method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export function OffersWorkspace() {
  const { access, api } = useAdminSession();
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canReadMenu = access.permissions.includes("menu.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission) && canReadMenu;
  const entitled = access.features?.tenant_crm === true;
  const [items, setItems] = useState<Page<Offer>>();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [selected, setSelected] = useState<Offer>();
  const [clients, setClients] = useState<Page<Client>>();
  const [clientPage, setClientPage] = useState(1);
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<Form>();
  const [preview, setPreview] = useState<Preview>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (!permitted || !entitled || !canReadMenu) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    Promise.all([
      api<Promotion[]>("/tenant/promotions"),
      api<Page<Segment>>("/tenant/crm/segments?page=1&pageSize=100"),
    ]).then(([discounts, segmentPage]) => {
      if (!active) return;
      setPromotions(discounts);
      setSegments(segmentPage.items);
    }).catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, canReadMenu, entitled, permitted, refresh]);

  useEffect(() => {
    if (!permitted || !entitled || !canReadMenu) return;
    let active = true;
    const params = new URLSearchParams({ page: String(page), pageSize: "20" });
    if (status) params.set("status", status);
    if (search.trim()) params.set("q", search.trim());
    api<Page<Offer>>(`/tenant/crm/offers?${params}`).then((result) => { if (active) setItems(result); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, canReadMenu, entitled, page, permitted, refresh, search, status]);

  useEffect(() => {
    if (!selectedId || !permitted || !entitled || !canReadMenu) { setSelected(undefined); setClients(undefined); return; }
    let active = true;
    setSelected(undefined); setClients(undefined);
    api<Offer>(`/tenant/crm/offers/${selectedId}`).then((offer) => { if (active) setSelected(offer); })
      .catch((reason: Error) => { if (active) setError(reason.message); });
    api<Page<Client>>(`/tenant/crm/offers/${selectedId}/clients?page=${clientPage}&pageSize=20`)
      .then((result) => { if (active) setClients(result); }).catch((reason: Error) => { if (active) setError(reason.message); });
    return () => { active = false; };
  }, [api, canReadMenu, clientPage, entitled, permitted, refresh, selectedId]);

  function startNew() { setError(""); setNotice(""); setPreview(undefined); setForm({ name: "", description: "", promotionId: "", segmentId: "" }); }

  function edit(offer: Offer) {
    setError(""); setNotice(""); setPreview(undefined);
    setForm({ id: offer.id, name: offer.name, description: offer.description ?? "", promotionId: offer.promotionId, segmentId: offer.segmentId });
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const { id, ...payload } = form;
      const saved = await api<Offer>(id ? `/tenant/crm/offers/${id}` : "/tenant/crm/offers", json(id ? "PATCH" : "POST", payload));
      setForm(undefined); setSelectedId(saved.id); setNotice("پیش‌نویس پیشنهاد ذخیره شد."); setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function previewAudience() {
    if (!form?.segmentId) return;
    setBusy(true); setError(""); setNotice("");
    try { setPreview(await api<Preview>("/tenant/crm/offers/preview", json("POST", { segmentId: form.segmentId }))); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function transition(offer: Offer, action: "activate" | "end") {
    const prompt = action === "activate"
      ? "با فعال‌سازی، اعضای فعلی بخش‌بندی به‌صورت ثابت برای این پیشنهاد ثبت می‌شوند. ادامه می‌دهید؟"
      : "پیشنهاد پایان می‌یابد و تخفیف آن دیگر از مسیر این پیشنهاد اعمال نمی‌شود. ادامه می‌دهید؟";
    if (!window.confirm(prompt)) return;
    setBusy(true); setError(""); setNotice("");
    try {
      await api(`/tenant/crm/offers/${offer.id}/${action}`, json("POST"));
      setNotice(action === "activate" ? "پیشنهاد فعال شد." : "پیشنهاد پایان یافت.");
      setRefresh((value) => value + 1);
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  if (!permitted || !canReadMenu) return <section className="tenant-crm-state"><h1>پیشنهادهای مشتریان</h1><p>برای مشاهده پیشنهادها، دسترسی CRM و مشاهده منو و تخفیف‌ها لازم است.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>پیشنهادهای مشتریان</h1><p>مدیریت پیشنهادهای CRM در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;
  const pages = Math.max(1, Math.ceil((items?.total ?? 0) / 20));

  return <section className="tenant-crm tenant-crm-offers" dir="rtl" aria-busy={loading}>
    <header className="tenant-crm-heading"><div><p className="eyebrow">CRM مشتریان</p><h1>پیشنهادهای هدفمند</h1><p>بخش‌بندی CRM را به تخفیف‌های موجود وصل کنید؛ قواعد قیمت‌گذاری همان قواعد ماژول تخفیف است.</p></div><div className="tenant-crm-heading-actions"><Link href="/admin/promotions">مدیریت تخفیف‌ها</Link><Link href="/admin/crm/segments">بخش‌بندی‌ها</Link>{canManage && <button type="button" onClick={startNew}>پیشنهاد جدید</button>}</div></header>
    {notice && <p className="tenant-crm-offer-notice" role="status">{notice}</p>}
    {error && <div className="tenant-crm-message" role="alert"><p>{error}</p><button type="button" onClick={() => { setError(""); setRefresh((value) => value + 1); }}>تلاش دوباره</button></div>}
    {form && <form className="tenant-crm-section tenant-crm-offer-form" onSubmit={(event) => void save(event)} aria-busy={busy}>
      <div className="tenant-crm-section-heading"><div><h2>{form.id ? "ویرایش پیش‌نویس" : "ساخت پیش‌نویس پیشنهاد"}</h2><p>برای قیمت، محدودیت، کد و زمان‌بندی به ماژول تخفیف بروید.</p></div><button type="button" onClick={() => setForm(undefined)} disabled={busy}>بستن</button></div>
      <label>نام پیشنهاد<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>توضیح<textarea maxLength={500} rows={3} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label>تخفیف موجود<select required value={form.promotionId} onChange={(event) => setForm({ ...form, promotionId: event.target.value })}><option value="">انتخاب تخفیف</option>{promotions.map((promotion) => <option key={promotion.id} value={promotion.id}>{promotion.name} · {promotionStatusNames[promotion.status] ?? promotion.status} · {rewardNames[promotion.rewardType] ?? promotion.rewardType}</option>)}</select></label>
      <label>بخش‌بندی مخاطب<select required value={form.segmentId} onChange={(event) => { setForm({ ...form, segmentId: event.target.value }); setPreview(undefined); }}><option value="">انتخاب بخش‌بندی فعال</option>{segments.map((segment) => <option key={segment.id} value={segment.id} disabled={!segment.isActive || !segment.criteriaValid}>{segment.name}{!segment.isActive ? " · غیرفعال" : !segment.criteriaValid ? " · معیار نامعتبر" : ""}</option>)}</select></label>
      <div className="tenant-crm-offer-form-actions"><button type="button" disabled={busy || !form.segmentId} onClick={() => void previewAudience()}>{busy ? "در حال بررسی…" : "پیش‌نمایش مخاطبان"}</button><button type="submit" disabled={busy || !canManage}>{busy ? "در حال ذخیره…" : "ذخیره پیش‌نویس"}</button></div>
      {preview && <div className="tenant-crm-offer-preview" role="status"><strong>{number.format(preview.matchingClients)} مشتری مطابق‌اند</strong><p>پیش‌نمایش تا ۵ نمونه با شماره پوشیده نشان می‌دهد. فهرست نهایی هنگام فعال‌سازی ثبت می‌شود.</p>{preview.sample.length > 0 && <ul>{preview.sample.map((client) => <li key={client.id}>{client.firstName} {client.lastName} <bdi dir="ltr">{client.phone}</bdi></li>)}</ul>}</div>}
    </form>}
    <div className="tenant-crm-offer-filters">
      <label>جست‌وجوی پیشنهاد<input type="search" maxLength={100} value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="نام پیشنهاد" /></label>
      <label>وضعیت<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="">همه وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="ACTIVE">فعال</option><option value="ENDED">پایان‌یافته</option></select></label>
    </div>
    {loading && !items ? <p className="tenant-crm-message" role="status">در حال دریافت پیشنهادها…</p> : items?.items.length ? <>
      <ul className="tenant-crm-list">{items.items.map((offer) => <li key={offer.id}>
        <article className={`tenant-crm-offer-card${selectedId === offer.id ? " is-selected" : ""}`}>
          <button className="tenant-crm-offer-select" type="button" onClick={() => { setSelectedId(offer.id); setClientPage(1); }} aria-expanded={selectedId === offer.id}>
            <span><strong>{offer.name}</strong><small>{offer.promotionName} · مخاطب: {offer.segmentNameSnapshot ?? offer.segmentName}</small></span>
            <span className={`tenant-crm-status tenant-crm-offer-status-${offer.status.toLowerCase()}`}>{statusNames[offer.status]}</span>
          </button>
          <p className="tenant-crm-offer-terms">تنظیم تخفیف: {offer.promotionActive ? "فعال" : "خاموش"} · شروع {dateLabel(offer.promotionStartsAt, access.tenant.timezone)} · پایان {dateLabel(offer.promotionEndsAt, access.tenant.timezone)}</p>
          <dl><div><dt>مخاطبان ثبت‌شده</dt><dd>{number.format(offer.audienceCount)}</dd></div><div><dt>کد تخفیف اعمال‌شده</dt><dd>{number.format(offer.redemptionCount)}</dd></div><div><dt>تخفیف ثبت‌شده در سفارش</dt><dd>{number.format(offer.appliedOrderCount)}</dd></div></dl>
          {canManage && <div className="tenant-crm-offer-actions">{offer.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => edit(offer)}>ویرایش</button>}{offer.status === "DRAFT" && <button type="button" disabled={busy} onClick={() => void transition(offer, "activate")}>فعال‌سازی</button>}{offer.status === "ACTIVE" && <button type="button" disabled={busy} onClick={() => void transition(offer, "end")}>پایان پیشنهاد</button>}</div>}
        </article>
      </li>)}</ul>
      <footer className="tenant-crm-pagination"><span>{number.format((page - 1) * 20 + 1)} تا {number.format(Math.min(page * 20, items.total))} از {number.format(items.total)}</span><div><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {number.format(page)} از {number.format(pages)}</span><button type="button" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>بعدی</button></div></footer>
    </> : <div className="tenant-crm-empty"><h2>پیشنهادی پیدا نشد</h2><p>از یک تخفیف موجود و یک بخش‌بندی فعال برای ساخت پیش‌نویس استفاده کنید.</p></div>}
    {selectedId && <section className="tenant-crm-section tenant-crm-offer-audience" aria-labelledby="tenant-crm-offer-audience-title">
      <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-offer-audience-title">مخاطبان پیشنهاد</h2><p>{selected ? `اعضای ثبت‌شده برای «${selected.name}»` : "در حال دریافت…"}</p></div></div>
      {clients?.items.length ? <><ul>{clients.items.map((client) => <li key={client.id}><span>{client.firstName} {client.lastName}</span><bdi dir="ltr">{client.phone}</bdi></li>)}</ul><footer className="tenant-crm-pagination"><span>{number.format(clients.total)} عضو</span><div><button type="button" disabled={clientPage <= 1} onClick={() => setClientPage((value) => value - 1)}>قبلی</button><span>صفحه {number.format(clientPage)}</span><button type="button" disabled={clientPage * clients.pageSize >= clients.total} onClick={() => setClientPage((value) => value + 1)}>بعدی</button></div></footer></>
        : <p className="tenant-crm-inline-empty">{selected?.status === "DRAFT" ? "مخاطبان هنگام فعال‌سازی ثبت می‌شوند." : "مخاطبی در این صفحه نیست."}</p>}
    </section>}
  </section>;
}
