"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type Api = <T>(path: string, init?: RequestInit) => Promise<T>;
type Program = { configured: boolean; enabled: boolean; spendPerPointToman: string | null };
type Reward = { id: string; name: string; description: string | null; pointsCost: string; eligible: boolean };
type LedgerItem = { id: string; entryType: string; points: string; description: string | null; createdAt: string; actorLabel: string | null };
type Redemption = { id: string; rewardName: string; pointsSpent: string; redeemedAt: string };
type Summary = { clientStatus: string; balance: string; program: Program; rewards: Reward[]; recentLedger: LedgerItem[]; ledgerTotal: number; recentRedemptions: Redemption[] };
type LedgerPage = { items: LedgerItem[]; balance: string; total: number; page: number; pageSize: number };

const numbers = new Intl.NumberFormat("fa-IR");
const formatPoints = (points: string) => numbers.format(BigInt(points));
const dateTime = (value: string, timeZone: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));

export function TenantCrmLoyaltyPanel({ clientId, api, canManage, timeZone }: { clientId: string; api: Api; canManage: boolean; timeZone: string }) {
  const [summary, setSummary] = useState<Summary>();
  const [items, setItems] = useState<LedgerItem[]>([]);
  const [page, setPage] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");
  const [adjustmentPoints, setAdjustmentPoints] = useState("");
  const [direction, setDirection] = useState<"CREDIT" | "DEBIT">("CREDIT");
  const [reason, setReason] = useState("");
  const [ledgerTotal, setLedgerTotal] = useState(0);

  async function load(reset = false) {
    setError("");
    const result = await api<Summary>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/loyalty`);
    setSummary(result);
    setLedgerTotal(result.ledgerTotal);
    if (reset || page === 0) { setItems(result.recentLedger); setPage(0); }
  }

  useEffect(() => { let active = true; setSummary(undefined); setItems([]); setPage(0); setLedgerTotal(0); setError(""); setNotice(""); api<Summary>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/loyalty`).then((value) => { if (active) { setSummary(value); setItems(value.recentLedger); } }).catch((reason: Error) => { if (active) setError(reason.message); }); return () => { active = false; }; }, [api, clientId]);

  async function adjust(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !adjustmentPoints || !reason.trim()) return;
    setBusy("adjust"); setError(""); setNotice("");
    try {
      await api(`/tenant/crm/clients/${encodeURIComponent(clientId)}/loyalty/adjust`, { method: "POST", body: JSON.stringify({ direction, points: Number(adjustmentPoints), reason, idempotencyKey: crypto.randomUUID() }) });
      setAdjustmentPoints(""); setReason(""); setNotice("تغییر امتیاز ثبت شد."); await load(true);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(""); }
  }

  async function redeem(reward: Reward) {
    if (busy || !reward.eligible || !window.confirm(`دریافت «${reward.name}» با ${formatPoints(reward.pointsCost)} امتیاز انجام شود؟`)) return;
    setBusy(reward.id); setError(""); setNotice("");
    try {
      await api(`/tenant/crm/clients/${encodeURIComponent(clientId)}/loyalty/redeem`, { method: "POST", body: JSON.stringify({ rewardId: reward.id, idempotencyKey: crypto.randomUUID() }) });
      setNotice("دریافت جایزه ثبت شد."); await load(true);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(""); }
  }

  async function loadMore() {
    const nextPage = page + 1;
    setBusy("history"); setError("");
    try {
      const result = await api<LedgerPage>(`/tenant/crm/clients/${encodeURIComponent(clientId)}/loyalty/ledger?page=${nextPage}&pageSize=20`);
      setItems((current) => nextPage === 1 ? result.items : [...current, ...result.items]); setPage(nextPage); setLedgerTotal(result.total);
    } catch (failure) { setError((failure as Error).message); }
    finally { setBusy(""); }
  }

  return <section className="tenant-crm-section tenant-crm-loyalty" aria-labelledby="tenant-crm-loyalty-title" aria-busy={busy !== ""}>
    <div className="tenant-crm-section-heading"><div><h2 id="tenant-crm-loyalty-title">وفاداری و امتیازها</h2><p>سوابق امتیاز و جوایز همین کافه</p></div>{canManage && <Link href="/admin/crm/loyalty">تنظیم برنامه و جوایز</Link>}</div>
    {error && <p className="tenant-crm-inline-error" role="alert">{error}</p>}{notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {!summary ? <p className="tenant-crm-inline-empty" role={error ? undefined : "status"}>{error ? "اطلاعات وفاداری دریافت نشد." : "در حال دریافت اطلاعات وفاداری…"}</p> : <>
      <div className="tenant-crm-loyalty-balance"><span>موجودی امتیاز</span><strong>{formatPoints(summary.balance)}</strong><small>{summary.program.configured ? summary.program.enabled ? `هر ${numbers.format(Number(summary.program.spendPerPointToman))} تومان سفارش تحویل‌شده = ۱ امتیاز` : "برنامه غیرفعال است؛ سوابق حفظ شده‌اند." : "برنامه وفاداری هنوز تنظیم نشده است."}</small></div>
      {summary.rewards.length > 0 && <div className="tenant-crm-loyalty-rewards"><h3>جوایز</h3><ul>{summary.rewards.map((reward) => <li key={reward.id}><span><strong>{reward.name}</strong><small>{numbers.format(BigInt(reward.pointsCost))} امتیاز{reward.description ? ` · ${reward.description}` : ""}</small></span>{canManage && <button type="button" disabled={!reward.eligible || busy !== ""} onClick={() => void redeem(reward)}>{busy === reward.id ? "در حال ثبت…" : summary.clientStatus !== "ACTIVE" ? "مشتری مسدود است" : !summary.program.enabled ? "برنامه غیرفعال است" : reward.eligible ? "ثبت دریافت" : "امتیاز کافی نیست"}</button>}</li>)}</ul></div>}
      {summary.clientStatus !== "ACTIVE" && <p className="tenant-crm-note">مشتری مسدود است؛ اصلاح امتیاز و دریافت جایزه غیرفعال هستند.</p>}
      {canManage && summary.clientStatus === "ACTIVE" && <form className="tenant-crm-loyalty-adjust" onSubmit={(event) => void adjust(event)}>
        <h3>اصلاح امتیاز</h3><label className="tenant-crm-control">نوع تغییر<select value={direction} onChange={(event) => setDirection(event.target.value as "CREDIT" | "DEBIT")}><option value="CREDIT">افزودن</option><option value="DEBIT">کسر</option></select></label>
        <label className="tenant-crm-control">تعداد امتیاز<input type="number" min="1" max="1000000000" step="1" required value={adjustmentPoints} onChange={(event) => setAdjustmentPoints(event.target.value)} /></label>
        <label className="tenant-crm-control">دلیل داخلی<input maxLength={500} required value={reason} onChange={(event) => setReason(event.target.value)} placeholder="مثلاً جبران مشکل سفارش" /></label>
        <button type="submit" disabled={busy !== ""}>{busy === "adjust" ? "در حال ثبت…" : "ثبت اصلاح"}</button>
      </form>}
      <div className="tenant-crm-loyalty-ledger"><h3>فعالیت اخیر</h3>{items.length ? <ul>{items.map((item) => <li key={item.id}><span><strong>{item.description ?? (item.entryType === "EARN" ? "امتیاز سفارش" : "فعالیت امتیاز")}</strong><small>{dateTime(item.createdAt, timeZone)}{item.actorLabel ? ` · کاربر ${item.actorLabel}` : ""}</small></span><b className={BigInt(item.points) > BigInt(0) ? "is-credit" : "is-debit"}>{BigInt(item.points) > BigInt(0) ? "+" : "−"}{formatPoints((BigInt(item.points) < BigInt(0) ? -BigInt(item.points) : BigInt(item.points)).toString())}</b></li>)}</ul> : <p className="tenant-crm-inline-empty">هنوز فعالیت امتیازی ثبت نشده است.</p>}
        {items.length < (page === 0 ? summary.ledgerTotal : ledgerTotal) && <button type="button" onClick={() => void loadMore()} disabled={busy !== ""}>{busy === "history" ? "در حال دریافت…" : page === 0 ? "نمایش تاریخچه کامل" : "نمایش موارد قدیمی‌تر"}</button>}
      </div>
      {summary.recentRedemptions.length > 0 && <div className="tenant-crm-loyalty-ledger"><h3>دریافت‌های اخیر</h3><ul>{summary.recentRedemptions.map((entry) => <li key={entry.id}><span><strong>{entry.rewardName}</strong><small>{dateTime(entry.redeemedAt, timeZone)}</small></span><b className="is-debit">−{formatPoints(entry.pointsSpent)}</b></li>)}</ul></div>}
    </>}
  </section>;
}
