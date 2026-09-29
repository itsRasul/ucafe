"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { useAdminSession } from "../admin-session";
import { SupportFilePicker, SupportMessageAttachments } from "../../support-attachments";
import type { AttachmentLoader } from "../../support-attachment-model";
import {
  canReply, createTicket, departmentLabel, departments, emptyTicketDescription,
  emptyTicketTitle, formatTicketDate, NewTicket, replyToTicket, runWhilePending,
  senderLabel, senderSide, statusLabel, statusMessage, ticketListPresentation,
  supportErrorMessage, TicketDetail, TicketErrors, TicketField, TicketPage, TicketStatus,
  validateReply, validateTicketForm,
} from "./support-model";

const pageSize = 25;
const faNumber = new Intl.NumberFormat("fa-IR");
const fieldNames: Record<TicketField, string> = { department: "واحد پشتیبانی", subject: "موضوع", message: "پیام" };
const fieldIds: Record<TicketField, string> = { department: "ticket-department", subject: "ticket-subject", message: "ticket-message" };

function statusClass(status: TicketStatus) {
  return `support-status support-status--${status.toLowerCase()}`;
}

function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <span className={statusClass(status)}>{statusLabel(status)}</span>;
}

export function EmptySupportTickets() {
  return <div className="support-empty">
    <span className="support-empty-icon" aria-hidden="true"><i /><i /></span>
    <h2>{emptyTicketTitle}</h2>
    <p>{emptyTicketDescription}</p>
    <Link className="support-primary-link" href="/admin/support/new">ثبت تیکت جدید</Link>
  </div>;
}

export function SupportTicketCards({ tickets, timeZone }: { tickets: TicketPage["items"]; timeZone: string }) {
  return <ul className="support-ticket-list">
    {tickets.map((ticket) => {
      const presentation = ticketListPresentation(ticket, timeZone);
      return <li key={ticket.id}>
        <Link className="support-ticket-card" href={`/admin/support/${encodeURIComponent(ticket.id)}`}>
          <span className="support-ticket-main">
            <span className="support-ticket-topline"><b dir="ltr">{presentation.reference}</b><TicketStatusBadge status={ticket.status} />{ticket.hasUnread && <span className="support-unread">پاسخ جدید</span>}</span>
            <strong>{presentation.subject}</strong>
            <span className="support-ticket-meta"><span>{presentation.department}</span><time dateTime={ticket.lastActivityAt}>{presentation.activity}</time></span>
          </span>
          <span className="support-ticket-arrow" aria-hidden="true">‹</span>
        </Link>
      </li>;
    })}
  </ul>;
}

export function SupportTicketMessages({ messages, timeZone, loadAttachment }: { messages: TicketDetail["messages"]; timeZone: string; loadAttachment?: AttachmentLoader }) {
  return <ol className="support-messages">
    {messages.map((item) => <li key={item.id} className={`support-message support-message--${senderSide(item.senderType)}`}>
      <div className="support-message-meta"><strong>{senderLabel(item.senderType)}</strong><time dateTime={item.createdAt}>{formatTicketDate(item.createdAt, timeZone)}</time></div>
      <p>{item.body}</p>
      {loadAttachment && <SupportMessageAttachments attachments={item.attachments} loadBlob={loadAttachment} />}
    </li>)}
  </ol>;
}

export function ClosedTicketNotice({ manual }: { manual: boolean }) {
  return <div className="support-closed-note"><strong>{manual ? "این تیکت به‌صورت دستی بسته شده است." : "این تیکت بسته شده است."}</strong><p>برای پیگیری موضوعی تازه، یک تیکت جدید ثبت کنید.</p><Link href="/admin/support/new">ثبت تیکت جدید</Link></div>;
}

export function SupportTicketFields({ input, errors, onChange, onBlur, disabled = false }: {
  input: NewTicket;
  errors: TicketErrors;
  disabled?: boolean;
  onChange: (field: TicketField, value: string) => void;
  onBlur: (field: TicketField) => void;
}) {
  return <>
    <label className="support-field" htmlFor={fieldIds.department}><span>واحد پشتیبانی <b aria-hidden="true">*</b></span>
      <select id={fieldIds.department} required disabled={disabled} value={input.department} onChange={(event) => onChange("department", event.target.value)} onBlur={() => onBlur("department")} aria-invalid={Boolean(errors.department)} aria-describedby={errors.department ? "ticket-department-error" : undefined}>
        <option value="">انتخاب کنید</option>{departments.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
      </select>
      {errors.department && <small id="ticket-department-error" className="support-field-error">{errors.department}</small>}
    </label>
    <label className="support-field" htmlFor={fieldIds.subject}><span>موضوع <b aria-hidden="true">*</b></span>
      <input id={fieldIds.subject} required disabled={disabled} maxLength={160} value={input.subject} onChange={(event) => onChange("subject", event.target.value)} onBlur={() => onBlur("subject")} aria-invalid={Boolean(errors.subject)} aria-describedby={errors.subject ? "ticket-subject-error" : "ticket-subject-help"} />
      {errors.subject ? <small id="ticket-subject-error" className="support-field-error">{errors.subject}</small> : <small id="ticket-subject-help">حداکثر ۱۶۰ نویسه</small>}
    </label>
    <label className="support-field" htmlFor={fieldIds.message}><span>شرح درخواست <b aria-hidden="true">*</b></span>
      <textarea id={fieldIds.message} required disabled={disabled} maxLength={10000} rows={7} value={input.message} onChange={(event) => onChange("message", event.target.value)} onBlur={() => onBlur("message")} aria-invalid={Boolean(errors.message)} aria-describedby={errors.message ? "ticket-message-error" : "ticket-message-help"} />
      {errors.message ? <small id="ticket-message-error" className="support-field-error">{errors.message}</small> : <small id="ticket-message-help">تا ۱۰٬۰۰۰ نویسه · {faNumber.format(input.message.length)}</small>}
    </label>
  </>;
}

export function SupportTicketList() {
  const { access, api } = useAdminSession();
  const permitted = access.permissions.includes("support.tickets.use");
  const [result, setResult] = useState<TicketPage>();
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!permitted) { setLoading(false); return; }
    let active = true;
    setLoading(true);
    setError("");
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    api<TicketPage>(`/tenant/support/tickets?${query}`)
      .then((value) => {
        if (!active) return;
        const lastPage = Math.max(1, Math.ceil(value.total / value.pageSize));
        if (page > lastPage) setPage(lastPage);
        else setResult(value);
      })
      .catch((reason: unknown) => { if (active) setError(supportErrorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, page, permitted, refresh]);

  if (!permitted) return <section className="admin-section-state"><h1>پشتیبانی</h1><p>نقش شما اجازه استفاده از این بخش را ندارد.</p></section>;
  const pages = Math.max(1, Math.ceil((result?.total ?? 0) / pageSize));

  return <section className="admin-support" dir="rtl" aria-busy={loading}>
    <header className="admin-page-heading">
      <div><h1>پشتیبانی</h1><p>گفت‌وگوهای شما با تیم پشتیبانی یوکافه</p></div>
      <Link className="support-primary-link" href="/admin/support/new"><span aria-hidden="true">＋</span> ثبت تیکت جدید</Link>
    </header>

    {error ? <div className="admin-message error" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div>
      : loading && !result ? <div className="admin-inline-loading" role="status"><span className="admin-spinner" aria-hidden="true" />در حال دریافت تیکت‌ها…</div>
        : result?.items.length ? <>
          {loading && <p className="support-refreshing" role="status">در حال به‌روزرسانی فهرست…</p>}
          <SupportTicketCards tickets={result.items} timeZone={access.tenant.timezone} />
          <footer className="support-pagination">
            <span>{faNumber.format((page - 1) * pageSize + 1)} تا {faNumber.format(Math.min(page * pageSize, result.total))} از {faNumber.format(result.total)} تیکت</span>
            <div><button type="button" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>قبلی</button><span>صفحه {faNumber.format(page)} از {faNumber.format(pages)}</span><button type="button" disabled={page >= pages || loading} onClick={() => setPage((value) => value + 1)}>بعدی</button></div>
          </footer>
        </> : <EmptySupportTickets />}
  </section>;
}

export function NewSupportTicket() {
  const { access, api } = useAdminSession();
  const router = useRouter();
  const lock = useRef(false);
  const errorSummary = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState<NewTicket>({ department: "", subject: "", message: "" });
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<TicketErrors>({});
  const [focusSummary, setFocusSummary] = useState(false);
  const [apiError, setApiError] = useState("");
  const [busy, setBusy] = useState(false);
  const permitted = access.permissions.includes("support.tickets.use");
  const invalidFields = Object.entries(errors) as Array<[TicketField, string]>;

  useEffect(() => { if (focusSummary) errorSummary.current?.focus(); }, [focusSummary]);

  function change(field: TicketField, value: string) {
    const next = { ...input, [field]: value } as NewTicket;
    setInput(next);
    setApiError("");
    setFocusSummary(false);
    if (errors[field]) setErrors((current) => ({ ...current, [field]: validateTicketForm(next)[field] }));
  }

  function blur(field: TicketField) {
    const fieldErrors = validateTicketForm(input);
    setErrors((current) => ({ ...current, [field]: fieldErrors[field] }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors = validateTicketForm(input);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) { setFocusSummary(true); return; }
    setFocusSummary(false);
    await runWhilePending(lock, async () => {
      setBusy(true);
      setApiError("");
      try {
        const ticket = await createTicket(api, input, files);
        setFiles([]);
        router.push(`/admin/support/${encodeURIComponent(ticket.id)}`);
      } catch (reason) {
        setApiError(supportErrorMessage(reason));
      } finally {
        setBusy(false);
      }
    });
  }

  if (!permitted) return <section className="admin-section-state"><h1>ثبت تیکت پشتیبانی</h1><p>نقش شما اجازه استفاده از این بخش را ندارد.</p><Link href="/admin">بازگشت به پنل</Link></section>;

  return <section className="admin-support" dir="rtl">
    <header className="admin-page-heading"><div><Link className="support-back-link" href="/admin/support">بازگشت به پشتیبانی</Link><h1>ثبت تیکت جدید</h1><p>واحد مرتبط را انتخاب کنید و موضوع و شرح درخواست خود را بنویسید.</p></div></header>
    <form className="support-form" onSubmit={submit} noValidate aria-busy={busy}>
      {focusSummary && invalidFields.length > 0 && <div className="admin-message error support-error-summary" role="alert" aria-labelledby="support-error-title" tabIndex={-1} ref={errorSummary}>
        <strong id="support-error-title">پیش از ارسال، این موارد را بررسی کنید:</strong>
        <ul>{invalidFields.map(([field, message]) => <li key={field}><a href={`#${fieldIds[field]}`}>{fieldNames[field]}: {message}</a></li>)}</ul>
      </div>}
      {apiError && <p className="admin-message error" role="alert">{apiError}</p>}
      <SupportTicketFields input={input} errors={errors} onChange={change} onBlur={blur} disabled={busy} />
      <SupportFilePicker files={files} onChange={setFiles} disabled={busy} />
      <footer className="support-form-actions"><Link href="/admin/support">انصراف</Link><button type="submit" disabled={busy}>{busy && <span className="admin-spinner" aria-hidden="true" />}{busy ? "در حال ثبت…" : "ارسال تیکت"}</button></footer>
    </form>
  </section>;
}

export function SupportTicketDetail({ ticketId }: { ticketId: string }) {
  const { access, api } = useAdminSession();
  const permitted = access.permissions.includes("support.tickets.use");
  const lock = useRef(false);
  const [ticket, setTicket] = useState<TicketDetail>();
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [replyError, setReplyError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!permitted) { setLoading(false); return; }
    let active = true;
    setTicket(undefined);
    setLoading(true);
    setError("");
    api<TicketDetail>(`/tenant/support/tickets/${encodeURIComponent(ticketId)}`)
      .then((value) => { if (active) setTicket(value); })
      .catch((reason: unknown) => { if (active) setError(supportErrorMessage(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, permitted, refresh, ticketId]);

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ticket || !canReply(ticket.status, ticket.closeReason)) return;
    const validationError = validateReply(message);
    if (validationError) { setReplyError(validationError); return; }
    await runWhilePending(lock, async () => {
      setBusy(true);
      setReplyError("");
      setError("");
      setNotice("");
      try {
        setTicket(await replyToTicket(api, ticket.id, message, files));
        setMessage("");
        setFiles([]);
        setNotice("پاسخ شما ارسال شد.");
      } catch (reason) {
        setReplyError(supportErrorMessage(reason));
        const status = reason && typeof reason === "object" && "status" in reason ? Number(reason.status) : 0;
        if (status === 409) {
          try { setTicket(await api<TicketDetail>(`/tenant/support/tickets/${encodeURIComponent(ticket.id)}`)); } catch { /* Keep the mutation error visible. */ }
        }
      } finally {
        setBusy(false);
      }
    });
  }

  if (!permitted) return <section className="admin-section-state"><h1>تیکت پشتیبانی</h1><p>نقش شما اجازه استفاده از این بخش را ندارد.</p><Link href="/admin">بازگشت به پنل</Link></section>;
  if (error && !ticket) return <section className="admin-support" dir="rtl"><header className="admin-page-heading"><div><Link className="support-back-link" href="/admin/support">بازگشت به پشتیبانی</Link><h1>تیکت پشتیبانی</h1></div></header><div className="admin-message error" role="alert"><p>{error}</p><button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></div></section>;
  if (loading || !ticket) return <section className="admin-support" dir="rtl"><div className="admin-inline-loading" role="status"><span className="admin-spinner" aria-hidden="true" />در حال دریافت گفت‌وگو…</div></section>;

  const replyable = canReply(ticket.status, ticket.closeReason);
  return <section className="admin-support" dir="rtl" aria-busy={loading}>
    <header className="admin-page-heading support-detail-heading">
      <div><Link className="support-back-link" href="/admin/support">بازگشت به فهرست تیکت‌ها</Link><div className="support-reference" dir="ltr">{ticket.referenceNumber}</div><h1>{ticket.subject}</h1></div>
      <TicketStatusBadge status={ticket.status} />
    </header>
    <dl className="support-ticket-metadata"><div><dt>واحد پشتیبانی</dt><dd>{departmentLabel(ticket.department)}</dd></div><div><dt>زمان ثبت</dt><dd><time dateTime={ticket.createdAt}>{formatTicketDate(ticket.createdAt, access.tenant.timezone)}</time></dd></div></dl>
    <p className={`support-status-note ${ticket.status === "WAITING_FOR_TENANT" ? "is-your-turn" : ""}`} role="status">{ticket.status === "CLOSED" && ticket.closeReason === "INACTIVITY" ? "این گفت‌وگو به‌دلیل بی‌پاسخ‌ماندن بسته شده؛ با ارسال پیام می‌توانید پیگیری را ادامه دهید." : statusMessage(ticket.status)}</p>
    {error && <p className="admin-message error" role="alert">{error}<button type="button" onClick={() => setRefresh((value) => value + 1)}>تلاش دوباره</button></p>}
    <section className="support-conversation" aria-labelledby="support-conversation-title">
      <h2 id="support-conversation-title">گفت‌وگو</h2>
      <SupportTicketMessages messages={ticket.messages} timeZone={access.tenant.timezone} loadAttachment={(path) => api<Blob>(path)} />
    </section>
    {notice && <p className="admin-message success" role="status">{notice}</p>}
    {replyable ? <form className="support-reply" onSubmit={submitReply} aria-busy={busy}>
      <label className="support-field" htmlFor="ticket-reply"><span>پاسخ شما</span><textarea id="ticket-reply" required disabled={busy} maxLength={10000} rows={5} value={message} onChange={(event) => { setMessage(event.target.value); setReplyError(""); }} aria-invalid={Boolean(replyError)} aria-describedby={replyError ? "ticket-reply-error" : "ticket-reply-help"} /></label>
      <SupportFilePicker files={files} onChange={setFiles} disabled={busy} />
      {replyError && <p className="support-field-error" id="ticket-reply-error" role="alert">{replyError}</p>}
      {!replyError && <small id="ticket-reply-help" className="support-reply-help">پاسخ شما به گفت‌وگوی این تیکت اضافه می‌شود.</small>}
      <button type="submit" disabled={busy}>{busy && <span className="admin-spinner" aria-hidden="true" />}{busy ? "در حال ارسال…" : "ارسال پاسخ"}</button>
    </form> : <ClosedTicketNotice manual={ticket.closeReason === "MANUAL"} />}
  </section>;
}
