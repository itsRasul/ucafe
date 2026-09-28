"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { TenantPermission, useAdminSession } from "../admin-session";

type Program = { configured: boolean; id?: string; enabled: boolean; spendPerPointToman: string | null; updatedAt?: string | null };
type Reward = { id: string; name: string; description: string | null; pointsCost: string; isActive: boolean };
type RewardInput = { name: string; description: string | null; pointsCost: number };
type RewardPage = { items: Reward[]; total: number; page: number; pageSize: number };
const numbers = new Intl.NumberFormat("fa-IR");

function RewardForm({ initial, busy, submitLabel, onSubmit, onCancel }: { initial?: Reward; busy: boolean; submitLabel: string; onSubmit: (input: RewardInput) => void; onCancel?: () => void }) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    onSubmit({ name: String(values.get("name") ?? ""), description: String(values.get("description") ?? "").trim() || null, pointsCost: Number(values.get("pointsCost")) });
  }
  return <form className="tenant-crm-loyalty-form" onSubmit={submit}>
    <label className="tenant-crm-control">نام جایزه<input name="name" required maxLength={120} defaultValue={initial?.name ?? ""} /></label>
    <label className="tenant-crm-control">توضیح (اختیاری)<input name="description" maxLength={500} defaultValue={initial?.description ?? ""} /></label>
    <label className="tenant-crm-control">هزینه امتیازی<input name="pointsCost" type="number" required min="1" max="1000000000" step="1" defaultValue={initial?.pointsCost ?? ""} /></label>
    <div className="tenant-crm-loyalty-actions"><button type="submit" disabled={busy}>{busy ? "در حال ذخیره…" : submitLabel}</button>{onCancel && <button type="button" onClick={onCancel} disabled={busy}>انصراف</button>}</div>
  </form>;
}

export function TenantCrmLoyaltyWorkspace() {
  const { access, api } = useAdminSession();
  const [program, setProgram] = useState<Program>();
  const [enabled, setEnabled] = useState(false);
  const [spendPerPoint, setSpendPerPoint] = useState("");
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [totalRewards, setTotalRewards] = useState(0);
  const [rewardPage, setRewardPage] = useState(1);
  const [editing, setEditing] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canRead = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;

  useEffect(() => {
    if (!canRead || !entitled) { setLoading(false); return; }
    let active = true;
    Promise.all([
      api<Program>("/tenant/crm/loyalty/program"),
      api<RewardPage>("/tenant/crm/loyalty/rewards?page=1&pageSize=100"),
    ]).then(([nextProgram, rewardResult]) => {
      if (!active) return;
      setProgram(nextProgram); setEnabled(nextProgram.enabled);
      setSpendPerPoint(nextProgram.spendPerPointToman ?? ""); setRewards(rewardResult.items);
      setTotalRewards(rewardResult.total); setRewardPage(rewardResult.page);
    }).catch((reason: Error) => { if (active) setError(reason.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, canRead, entitled]);

  async function reloadRewards() {
    const result = await api<RewardPage>(`/tenant/crm/loyalty/rewards?page=1&pageSize=100`);
    setRewards(result.items); setTotalRewards(result.total); setRewardPage(1);
  }

  async function saveProgram(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy("program"); setError(""); setNotice("");
    try {
      const next = await api<Program>("/tenant/crm/loyalty/program", { method: "PATCH", body: JSON.stringify({ enabled, spendPerPointToman: Number(spendPerPoint) }) });
      setProgram(next); setNotice("تنظیمات برنامه ذخیره شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  async function createReward(input: RewardInput) {
    setBusy("create"); setError(""); setNotice("");
    try { await api<Reward>("/tenant/crm/loyalty/rewards", { method: "POST", body: JSON.stringify(input) }); await reloadRewards(); setNotice("جایزه ساخته شد."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  async function updateReward(rewardId: string, input: Partial<RewardInput> & { isActive?: boolean }) {
    setBusy(rewardId); setError(""); setNotice("");
    try { await api(`/tenant/crm/loyalty/rewards/${encodeURIComponent(rewardId)}`, { method: "PATCH", body: JSON.stringify(input) }); await reloadRewards(); setEditing(null); setNotice("جایزه به‌روزرسانی شد."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  async function loadMoreRewards() {
    const nextPage = rewardPage + 1;
    setBusy("more"); setError("");
    try { const result = await api<RewardPage>(`/tenant/crm/loyalty/rewards?page=${nextPage}&pageSize=100`); setRewards((current) => [...current, ...result.items]); setRewardPage(result.page); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(""); }
  }

  if (!canRead) return <section className="tenant-crm-state"><h1>دسترسی محدود</h1><p>نقش شما اجازه مشاهده CRM را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>وفاداری مشتریان</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="tenant-crm tenant-crm-loyalty-workspace" dir="rtl" aria-busy={loading || busy !== ""}>
    <Link href="/admin/crm" className="tenant-crm-back">بازگشت به CRM مشتریان</Link>
    <header className="tenant-crm-heading"><div><p className="eyebrow">CRM مشتریان</p><h1>وفاداری و جوایز</h1><p>برنامه امتیازدهی و جوایز این کافه</p></div></header>
    {error && <p className="tenant-crm-inline-error" role="alert">{error}</p>}{notice && <p className="tenant-crm-success" role="status">{notice}</p>}
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت تنظیمات…</p> : <>
      <section className="tenant-crm-section" aria-labelledby="loyalty-program-title">
        <div className="tenant-crm-section-heading"><div><h2 id="loyalty-program-title">برنامه امتیاز</h2><p>برای هر مبلغ کامل تعیین‌شده در سفارش تحویل‌شده، یک امتیاز ثبت می‌شود. تغییرات فقط روی سفارش‌های آینده اثر دارند.</p></div></div>
        {program?.configured && <p className={`tenant-crm-loyalty-state ${program.enabled ? "is-active" : ""}`}>{program.enabled ? "برنامه فعال" : "برنامه غیرفعال"}</p>}
        <form className="tenant-crm-loyalty-program" onSubmit={(event) => void saveProgram(event)}>
          <label className="tenant-crm-control">مبلغ لازم برای یک امتیاز (تومان)<input type="number" min="1" max="1000000000" step="1" required value={spendPerPoint} onChange={(event) => setSpendPerPoint(event.target.value)} /></label>
          <label className="tenant-crm-loyalty-toggle"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />فعال‌سازی برنامه</label>
          <p className="tenant-crm-note">غیرفعال‌کردن برنامه، موجودی و سوابق را حفظ می‌کند و دریافت خودکار امتیاز و ثبت جایزه را متوقف می‌کند. اصلاح دستی امتیاز برای کاربر مجاز باقی می‌ماند.</p>
          {canManage && <button type="submit" disabled={busy !== ""}>{busy === "program" ? "در حال ذخیره…" : "ذخیره برنامه"}</button>}
          {!canManage && <p>برای تغییر تنظیمات به مجوز مدیریت CRM نیاز دارید.</p>}
        </form>
      </section>
      <section className="tenant-crm-section" aria-labelledby="loyalty-rewards-title">
        <div className="tenant-crm-section-heading"><div><h2 id="loyalty-rewards-title">جوایز</h2><p>{numbers.format(totalRewards)} جایزه ثبت‌شده · جوایز غیرفعال برای دریافت جدید نمایش داده نمی‌شوند.</p></div></div>
        {canManage && <RewardForm busy={busy === "create"} submitLabel="افزودن جایزه" onSubmit={(input) => void createReward(input)} />}
        {rewards.length ? <ul className="tenant-crm-loyalty-reward-list">{rewards.map((reward) => <li key={reward.id}>
          {editing === reward.id ? <RewardForm key={reward.id} initial={reward} busy={busy === reward.id} submitLabel="ذخیره جایزه" onSubmit={(input) => void updateReward(reward.id, input)} onCancel={() => setEditing(null)} /> : <>
            <div><strong>{reward.name}</strong><span>{numbers.format(BigInt(reward.pointsCost))} امتیاز{reward.description ? ` · ${reward.description}` : ""}</span></div>
            <div className="tenant-crm-loyalty-actions"><span className={`tenant-crm-loyalty-state ${reward.isActive ? "is-active" : ""}`}>{reward.isActive ? "فعال" : "غیرفعال"}</span>{canManage && <><button type="button" onClick={() => setEditing(reward.id)} disabled={busy !== ""}>ویرایش</button><button type="button" onClick={() => void updateReward(reward.id, { isActive: !reward.isActive })} disabled={busy !== ""}>{reward.isActive ? "غیرفعال‌کردن" : "فعال‌کردن"}</button></>}</div>
          </>}
        </li>)}</ul> : <p className="tenant-crm-inline-empty">هنوز جایزه‌ای تعریف نشده است.</p>}
        {rewards.length < totalRewards && <button type="button" className="tenant-crm-load-more" disabled={busy !== ""} onClick={() => void loadMoreRewards()}>{busy === "more" ? "در حال دریافت…" : "جوایز بیشتر"}</button>}
      </section>
    </>}
  </section>;
}
