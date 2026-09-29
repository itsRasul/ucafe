"use client";

import { useEffect, useState } from "react";

type ClientOffer = { id: string; name: string; status: "DRAFT" | "ACTIVE" | "ENDED"; segmentName: string; activatedAt: string | null; endedAt: string | null; grantedAt: string; promotionName: string; promotionActive: boolean; redemptionCount: number; appliedOrderCount: number };
type Page = { items: ClientOffer[]; total: number; page: number; pageSize: number };
const number = new Intl.NumberFormat("fa-IR");
const statusNames = { DRAFT: "پیش‌نویس", ACTIVE: "در مخاطبان Offer فعال", ENDED: "در تاریخچه · Offer پایان‌یافته" };

export function TenantCrmOffersPanel({ clientId, api }: { clientId: string; api: <T>(path: string, init?: RequestInit) => Promise<T> }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true); setError("");
    api<Page>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/offers?page=${page}&pageSize=20`)
      .then((result) => { if (active) setData((current) => page === 1 ? result : current ? { ...result, items: [...current.items, ...result.items] } : result); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, clientId, page, refresh]);

  const activeAudience = data?.items.filter((offer) => offer.status === "ACTIVE") ?? [];
  const history = data?.items.filter((offer) => offer.status !== "ACTIVE") ?? [];
  const offerList = (offers: ClientOffer[]) => <ul>{offers.map((offer) => <li key={offer.id}>
    <div className="tenant-crm-offer-client-heading"><strong>{offer.name}</strong><span className={`tenant-crm-status tenant-crm-offer-status-${offer.status.toLowerCase()}`}>{statusNames[offer.status]}</span></div>
    <p>{offer.promotionName} · بخش‌بندی هنگام فعال‌سازی: {offer.segmentName} · تنظیم تخفیف: {offer.promotionActive ? "فعال" : "خاموش"}</p>
    <dl><div><dt>بازخریدهای ثبت‌شده در Discounts</dt><dd>{number.format(offer.redemptionCount)}</dd></div><div><dt>سفارش دارای تخفیف در snapshot</dt><dd>{number.format(offer.appliedOrderCount)}</dd></div></dl>
    <small>عضویت در مخاطبان به‌تنهایی به معنی واجد شرایط بودن برای خرید نیست؛ شرایط و محدودیت‌های جاری Discounts همچنان اعمال می‌شوند.</small>
  </li>)}</ul>;

  return <section className="tenant-crm-section tenant-crm-offers-client" aria-labelledby="tenant-crm-client-offers-title">
    <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-client-offers-title">پیشنهادهای هدفمند</h2><p>عضویت هدف‌گیری از snapshot فعال‌سازی بخش‌بندی خوانده می‌شود.</p></div></div>
    {error ? <div className="tenant-crm-inline-error" role="alert"><span>{error}</span><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>
      : loading && !data ? <p className="tenant-crm-inline-empty" role="status">در حال دریافت پیشنهادها…</p>
        : data?.items.length ? <>
          {activeAudience.length > 0 && <div className="tenant-crm-offer-client-group"><h3>پیشنهادهای فعال برای مخاطب هدف‌گیری‌شده</h3>{offerList(activeAudience)}</div>}
          {history.length > 0 && <div className="tenant-crm-offer-client-group"><h3>تاریخچه پیشنهادهای پایان‌یافته</h3>{offerList(history)}</div>}
          <p className="tenant-crm-offer-source-note">این دو عدد از منبع ثبت متفاوت خوانده می‌شوند و ممکن است هم‌پوشانی داشته باشند.</p>
          {data.items.length < data.total && <button className="tenant-crm-load-more" type="button" disabled={loading} onClick={() => setPage((value) => value + 1)}>{loading ? "در حال دریافت…" : "نمایش پیشنهادهای قدیمی‌تر"}</button>}
        </> : <p className="tenant-crm-inline-empty">این مشتری در snapshot مخاطبان پیشنهادی ثبت نشده است.</p>}
  </section>;
}
