"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { TenantPermission, useAdminSession } from "../../admin-session";

type Feedback = {
  id: string; clientId: string; clientFirstName: string; clientLastName: string; rating: number; comment: string | null;
  source: "MANUAL" | "CUSTOMER_PANEL"; status: "NEW" | "NEEDS_ATTENTION" | "RESOLVED"; orderId: string | null; orderDisplayNumber: string | null;
  orderStatus: string | null; reservationId: string | null; reservationStatus: string | null; reservationDate: string | null;
  reservationStartTime: string | null; resolutionNote: string | null; resolvedAt: string | null; createdAt: string;
};

const number = new Intl.NumberFormat("fa-IR");
const statusLabel = (status: Feedback["status"]) => ({ NEW: "جدید", NEEDS_ATTENTION: "نیازمند پیگیری", RESOLVED: "رسیدگی‌شده" })[status];
const sourceLabel = (source: Feedback["source"]) => source === "MANUAL" ? "ثبت توسط کافه" : "ثبت توسط مشتری";
const dateTime = (value: string) => new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));

export function FeedbackDetail() {
  const { feedbackId } = useParams<{ feedbackId: string }>();
  const { access, api } = useAdminSession();
  const [feedback, setFeedback] = useState<Feedback>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [resolutionNote, setResolutionNote] = useState("");
  const [reminderOpen, setReminderOpen] = useState(false);
  const [reminderDueAt, setReminderDueAt] = useState("");
  const [reminderDescription, setReminderDescription] = useState("");
  const [notice, setNotice] = useState("");
  const permitted = access.permissions.includes("tenant_crm.read" as TenantPermission);
  const canManage = access.permissions.includes("tenant_crm.manage" as TenantPermission);
  const entitled = access.features?.tenant_crm === true;

  useEffect(() => {
    if (!permitted || !entitled) { setLoading(false); return; }
    let active = true;
    setLoading(true); setError("");
    api<Feedback>(`/tenant/crm/feedback/${encodeURIComponent(feedbackId)}`).then((value) => { if (active) setFeedback(value); })
      .catch((reason: Error) => { if (active) setError(reason.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, entitled, feedbackId, permitted, refresh]);

  async function markAttention() {
    if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { setFeedback(await api<Feedback>(`/tenant/crm/feedback/${feedbackId}/needs-attention`, { method: "POST" })); setNotice("بازخورد برای پیگیری علامت‌گذاری شد."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function resolve(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(""); setNotice("");
    try { setFeedback(await api<Feedback>(`/tenant/crm/feedback/${feedbackId}/resolve`, { method: "POST", body: JSON.stringify({ resolutionNote }) })); setNotice("رسیدگی به بازخورد ثبت شد."); }
    catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  async function createReminder(event: FormEvent) {
    event.preventDefault(); if (!feedback || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const reference = `پیگیری بازخورد ${feedback.id.slice(0, 8)}`;
      const description = [reference, reminderDescription.trim()].filter(Boolean).join("\n");
      await api(`/tenant/crm/clients/${feedback.clientId}/reminders`, { method: "POST", body: JSON.stringify({
        title: "پیگیری بازخورد مشتری", description, dueAt: new Date(reminderDueAt).toISOString(),
      }) });
      setReminderOpen(false); setReminderDueAt(""); setReminderDescription(""); setNotice("یادآوری پیگیری برای مشتری ثبت شد.");
    } catch (reason) { setError((reason as Error).message); }
    finally { setBusy(false); }
  }

  if (!permitted) return <section className="tenant-crm-state"><h1>بازخورد مشتری</h1><p>نقش شما اجازه مشاهده بازخوردها را ندارد.</p></section>;
  if (!entitled) return <section className="tenant-crm-state"><h1>بازخورد مشتری</h1><p>مدیریت مشتریان در اشتراک فعلی فعال نیست.</p><Link href="/admin/subscription">مشاهده اشتراک</Link></section>;

  return <section className="tenant-crm tenant-feedback-detail" dir="rtl" aria-busy={loading}>
    <Link className="tenant-crm-back" href="/admin/crm/feedback">بازگشت به بازخوردها</Link>
    {loading ? <p className="tenant-crm-message" role="status">در حال دریافت بازخورد…</p>
      : error && !feedback ? <div className="tenant-crm-message" role="alert"><h1>بازخورد در دسترس نیست</h1><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>
        : feedback ? <>
          <header className="tenant-crm-heading"><div><p className="eyebrow">بازخورد مشتری</p><h1>{feedback.clientFirstName} {feedback.clientLastName}</h1><p>{sourceLabel(feedback.source)} · {dateTime(feedback.createdAt)}</p></div><span className={`tenant-crm-status ${feedback.status === "NEEDS_ATTENTION" ? "is-feedback-attention" : feedback.status === "RESOLVED" ? "is-active" : ""}`}>{statusLabel(feedback.status)}</span></header>
          {notice && <p className="tenant-feedback-success" role="status">{notice}</p>}
          {error && <p className="tenant-feedback-error" role="alert">{error}</p>}
          <section className="tenant-crm-section tenant-feedback-detail-card" aria-labelledby="feedback-message-title">
            <div className="tenant-feedback-detail-rating"><strong className="tenant-feedback-stars" aria-label={`${feedback.rating} از ۵ ستاره`}>{"★".repeat(feedback.rating)}<span>{"★".repeat(5 - feedback.rating)}</span></strong><span>{number.format(feedback.rating)} از ۵</span></div>
            <h2 id="feedback-message-title">نظر مشتری</h2>
            {feedback.comment ? <p className="tenant-feedback-comment">{feedback.comment}</p> : <p className="tenant-feedback-muted">مشتری فقط امتیاز ثبت کرده است.</p>}
            <dl className="tenant-feedback-facts"><div><dt>منبع</dt><dd>{sourceLabel(feedback.source)}</dd></div><div><dt>ثبت‌شده</dt><dd>{dateTime(feedback.createdAt)}</dd></div>
              {feedback.orderId && <div><dt>سفارش مرتبط</dt><dd><Link href="/admin/orders">#{feedback.orderDisplayNumber}</Link> · {feedback.orderStatus}</dd></div>}
              {feedback.reservationId && <div><dt>رزرو مرتبط</dt><dd><Link href="/admin/reservations">{feedback.reservationDate}، {feedback.reservationStartTime}</Link> · {feedback.reservationStatus}</dd></div>}
            </dl>
          </section>
          <section className="tenant-crm-section tenant-feedback-recovery" aria-labelledby="feedback-recovery-title">
            <div className="tenant-crm-section-heading"><div><h2 id="feedback-recovery-title">پیگیری و رسیدگی</h2><p>یادداشت رسیدگی فقط برای کارکنان مجاز نمایش داده می‌شود.</p></div><Link href={`/admin/crm/clients/${feedback.clientId}`}>نمای ۳۶۰ درجه مشتری</Link></div>
            {feedback.resolvedAt && <div className="tenant-feedback-resolution"><strong>رسیدگی‌شده در {dateTime(feedback.resolvedAt)}</strong>{feedback.resolutionNote ? <p>{feedback.resolutionNote}</p> : <p className="tenant-feedback-muted">یادداشت داخلی ثبت نشده است.</p>}</div>}
            {canManage && feedback.status !== "RESOLVED" && <div className="tenant-feedback-actions">
              {feedback.status === "NEW" && <button type="button" disabled={busy} onClick={() => void markAttention()}>{busy ? "در حال ثبت…" : "علامت‌گذاری برای پیگیری"}</button>}
              <form onSubmit={(event) => void resolve(event)}><label htmlFor="feedback-resolution-note">یادداشت کوتاه داخلی (اختیاری)<textarea id="feedback-resolution-note" value={resolutionNote} maxLength={1000} rows={3} onChange={(event) => setResolutionNote(event.target.value)} placeholder="برای مثال: با مشتری تماس گرفته شد و عذرخواهی کردیم." /></label><button type="submit" disabled={busy}>{busy ? "در حال ثبت…" : "ثبت رسیدگی و بستن"}</button></form>
              <div className="tenant-feedback-reminder"><h3>یادآوری پیگیری</h3>{!reminderOpen ? <button type="button" disabled={busy} onClick={() => setReminderOpen(true)}>ساخت یادآوری برای این مشتری</button> : <form onSubmit={(event) => void createReminder(event)}><label htmlFor="feedback-reminder-due">زمان یادآوری<input id="feedback-reminder-due" type="datetime-local" value={reminderDueAt} onChange={(event) => setReminderDueAt(event.target.value)} required /></label><label htmlFor="feedback-reminder-description">جزئیات داخلی (اختیاری)<textarea id="feedback-reminder-description" value={reminderDescription} maxLength={3900} rows={3} onChange={(event) => setReminderDescription(event.target.value)} /></label><div><button type="submit" disabled={busy || !reminderDueAt}>{busy ? "در حال ثبت…" : "ثبت یادآوری"}</button><button type="button" disabled={busy} onClick={() => setReminderOpen(false)}>انصراف</button></div></form>}</div>
            </div>}
          </section>
        </> : <p className="tenant-crm-message">بازخورد پیدا نشد.</p>}
  </section>;
}
