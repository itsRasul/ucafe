"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { usePlatformSession } from "../use-platform-session";
import { SupportFilePicker, SupportMessageAttachments } from "../../support-attachments";
import { supportMessageBody } from "../../support-attachment-model";
import type { AttachmentLoader } from "../../support-attachment-model";
import {
  canViewSupport, departmentLabel, formatTicketDate, QueueFilters, queueQuery, queueReturnPath,
  senderLabel, statusLabel, SupportTicketDetail, SupportTicketListItem, SupportTicketMessage,
  TicketDepartment, ticketDepartments, TicketListResponse, ticketStatuses, TicketStatus, turnLabel,
  supportErrorMessage,
} from "./support-model";

const waitingQueue = "WAITING_FOR_PLATFORM";

export function PlatformSupportQueue({ filters }: { filters: QueueFilters }) {
  const { state, access, api } = usePlatformSession();
  const [result, setResult] = useState<TicketListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const query = queueQuery(filters);
  const canView = canViewSupport(access);

  useEffect(() => {
    if (state !== "ready" || !canView) return;
    let current = true;
    setLoading(true);
    setError("");
    api<TicketListResponse>(`/platform/support/tickets?${query}`)
      .then((value) => { if (current) setResult(value); })
      .catch((reason) => { if (current) setError(supportErrorMessage(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, canView, query, reloadKey, state]);

  return <SupportFrame title="پشتیبانی" description="صف تیکت‌های کافه‌ها و گفتگوهای پشتیبانی.">
    <SupportSessionState state={state} />
    {state === "ready" && !canView && <SupportAccessState />}
    {state === "ready" && canView && <>
      <form className="platform-support-filters" action="/platform/support" method="get">
        <label>جست‌وجوی تیکت، موضوع یا کافه
          <input type="search" name="search" maxLength={120} defaultValue={filters.search} placeholder="مثلاً UC-10482 یا ثبت سفارش" />
        </label>
        <label>نام یا زیردامنه کافه
          <input type="search" name="tenantSearch" maxLength={120} defaultValue={filters.tenantSearch} placeholder="نام کافه" />
        </label>
        <label>وضعیت
          <select name="status" defaultValue={filters.status}>
            <option value="">همه وضعیت‌ها</option>
            {ticketStatuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <label>واحد
          <select name="department" defaultValue={filters.department}>
            <option value="">همه واحدها</option>
            {ticketDepartments.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>
        <input type="hidden" name="page" value="1" />
        <input type="hidden" name="pageSize" value="25" />
        <div className="platform-support-filter-actions">
          <button type="submit">اعمال فیلتر</button>
          <Link href="/platform/support">پاک کردن فیلترها</Link>
        </div>
      </form>
      <SupportQueueBody loading={loading} error={error} items={result?.items ?? []} filtered={hasAdditionalFilters(filters)} returnTo={queueReturnPath(filters)} onRetry={() => setReloadKey((value) => value + 1)} />
      {result && !loading && !error && <QueuePagination result={result} filters={filters} />}
    </>}
  </SupportFrame>;
}

export function PlatformSupportTicket({ ticketId, returnTo }: { ticketId: string; returnTo: string }) {
  const { state, access, api } = usePlatformSession();
  const [ticket, setTicket] = useState<SupportTicketDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [reply, setReply] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [replyError, setReplyError] = useState("");
  const [replyPending, setReplyPending] = useState(false);
  const [pendingAction, setPendingAction] = useState("");
  const [department, setDepartment] = useState<TicketDepartment>("TECHNICAL");
  const replyLock = useRef(false);
  const manageLock = useRef(false);
  const canView = canViewSupport(access);
  const canReply = access.includes("support.tickets.reply");
  const canManage = access.includes("support.tickets.manage");

  const refreshTicket = useCallback(async () => {
    const value = await api<SupportTicketDetail>(`/platform/support/tickets/${encodeURIComponent(ticketId)}`);
    setTicket(value);
    setDepartment(value.department);
    return value;
  }, [api, ticketId]);

  useEffect(() => {
    if (state !== "ready" || !canView) return;
    let current = true;
    setLoading(true);
    setError("");
    api<SupportTicketDetail>(`/platform/support/tickets/${encodeURIComponent(ticketId)}`)
      .then((value) => { if (current) { setTicket(value); setDepartment(value.department); } })
      .catch((reason) => { if (current) setError(supportErrorMessage(reason)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [api, canView, reloadKey, state, ticketId]);

  async function submitReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (replyLock.current || !ticket || ticket.status === "CLOSED") return;
    const message = reply.trim();
    if (!message) { setReplyError("متن پاسخ را وارد کنید."); return; }
    if (message.length > 10000) { setReplyError("متن پاسخ نباید بیشتر از ۱۰۰۰۰ نویسه باشد."); return; }
    replyLock.current = true;
    setReplyPending(true);
    setReplyError("");
    setError("");
    try {
      const updated = await api<SupportTicketDetail>(`/platform/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
        method: "POST",
        body: supportMessageBody({ message }, files),
      });
      setTicket(updated);
      setDepartment(updated.department);
      setReply("");
      setFiles([]);
      setNotice("پاسخ برای کافه ثبت شد.");
    } catch (reason) {
      setReplyError(supportErrorMessage(reason));
      if ([404, 409].includes((reason as { status?: number })?.status ?? 0)) {
        try { await refreshTicket(); } catch { /* Keep the safe mutation error visible. */ }
      }
    } finally {
      replyLock.current = false;
      setReplyPending(false);
    }
  }

  async function manage(action: "CLOSE" | "REOPEN" | "CHANGE_DEPARTMENT", nextDepartment?: TicketDepartment) {
    if (manageLock.current || !ticket) return;
    manageLock.current = true;
    setPendingAction(action);
    setError("");
    setNotice("");
    try {
      const updated = await api<SupportTicketDetail>(`/platform/support/tickets/${encodeURIComponent(ticketId)}`, {
        method: "PATCH",
        body: JSON.stringify({ action, ...(nextDepartment ? { department: nextDepartment } : {}) }),
      });
      setTicket(updated);
      setDepartment(updated.department);
      setNotice(action === "CLOSE" ? "تیکت بسته شد." : action === "REOPEN" ? "تیکت دوباره باز شد." : "واحد تیکت تغییر کرد.");
    } catch (reason) {
      const status = (reason as { status?: number })?.status;
      if (status === 404 || status === 409) {
        try { await refreshTicket(); } catch { /* The safe error remains more useful than a second failure. */ }
      }
      setError(supportErrorMessage(reason));
    } finally {
      manageLock.current = false;
      setPendingAction("");
    }
  }

  function submitDepartment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (department !== ticket?.department) void manage("CHANGE_DEPARTMENT", department);
  }

  function confirmLifecycle(action: "CLOSE" | "REOPEN") {
    const prompt = action === "CLOSE" ? "این تیکت به‌صورت دستی بسته شود؟" : "این تیکت دوباره باز شود؟";
    if (window.confirm(prompt)) void manage(action);
  }

  return <SupportFrame title="جزئیات تیکت" description="گفتگو و وضعیت درخواست پشتیبانی." returnTo={returnTo}>
    <SupportSessionState state={state} />
    {state === "ready" && !canView && <SupportAccessState />}
    {state === "ready" && canView && <>
      {ticket && error && <SupportFailure message={error} action={<button type="button" onClick={() => setReloadKey((value) => value + 1)}>تلاش دوباره</button>} />}
      {notice && <p className="message success" role="status">{notice}</p>}
      {loading ? <SupportLoading /> : error && !ticket ? <SupportFailure message={error} action={<button type="button" onClick={() => setReloadKey((value) => value + 1)}>تلاش دوباره</button>} /> : ticket ? <>
        <header className="platform-support-ticket-heading">
          <div>
            <span className="platform-support-reference" dir="ltr"><bdi dir="ltr">{ticket.referenceNumber}</bdi></span>
            <h2>{ticket.subject}</h2>
          </div>
          <StatusBadge status={ticket.status} />
        </header>
        <dl className="platform-support-metadata">
          <div><dt>کافه</dt><dd>{ticket.tenant.name}</dd></div>
          <div><dt>زیردامنه</dt><dd dir="ltr"><bdi dir="ltr">{ticket.tenant.slug}</bdi></dd></div>
          <div><dt>واحد</dt><dd>{departmentLabel(ticket.department)}</dd></div>
          <div><dt>ثبت‌شده</dt><dd><time dateTime={ticket.createdAt}>{formatTicketDate(ticket.createdAt)}</time></dd></div>
          <div><dt>آخرین فعالیت</dt><dd><time dateTime={ticket.lastActivityAt}>{formatTicketDate(ticket.lastActivityAt)}</time></dd></div>
        </dl>
        <p className={`platform-support-turn ${ticket.status === waitingQueue ? "is-waiting" : ""}`} role="status">{turnLabel(ticket.status)}</p>
        {canManage && <section className="platform-support-management" aria-labelledby="support-management-heading">
          <h3 id="support-management-heading">مدیریت تیکت</h3>
          <form onSubmit={submitDepartment}>
            <label htmlFor="support-department">واحد پشتیبانی</label>
            <select id="support-department" value={department} onChange={(event) => setDepartment(event.target.value as TicketDepartment)} disabled={Boolean(pendingAction)}>
              {ticketDepartments.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
            </select>
            <button type="submit" disabled={Boolean(pendingAction) || department === ticket.department}>
              {pendingAction === "CHANGE_DEPARTMENT" ? "در حال ثبت…" : "تغییر واحد"}
            </button>
          </form>
          <div className="platform-support-lifecycle-actions">
            {ticket.status === "CLOSED"
              ? <button type="button" onClick={() => confirmLifecycle("REOPEN")} disabled={Boolean(pendingAction)}>{pendingAction === "REOPEN" ? "در حال بازگشایی…" : "بازگشایی تیکت"}</button>
              : <button type="button" className="danger" onClick={() => confirmLifecycle("CLOSE")} disabled={Boolean(pendingAction)}>{pendingAction === "CLOSE" ? "در حال بستن…" : "بستن تیکت"}</button>}
          </div>
        </section>}
        <TicketConversation messages={ticket.messages} loadAttachment={(path) => api<Blob>(path)} />
        {ticket.status === "CLOSED"
          ? <p className="platform-support-closed-note">برای ادامه گفتگو، تیکت را با دسترسی مدیریت بازگشایی کنید.</p>
          : canReply ? <form className="platform-support-reply" onSubmit={submitReply}>
            <label htmlFor="support-reply">پاسخ برای کافه</label>
            <textarea id="support-reply" value={reply} maxLength={10000} required disabled={replyPending} onChange={(event) => { setReply(event.target.value); setReplyError(""); }} />
            <SupportFilePicker files={files} onChange={setFiles} disabled={replyPending} />
            {replyError && <p className="message error" role="alert">{replyError}</p>}
            <button type="submit" disabled={replyPending || !reply.trim()}>{replyPending ? "در حال ارسال پاسخ…" : "ارسال پاسخ"}</button>
          </form> : <p className="platform-support-readonly">این حساب فقط اجازه مشاهده گفتگو را دارد.</p>}
      </> : null}
    </>}
  </SupportFrame>;
}

export function SupportQueueBody({
  loading, error, items, filtered, returnTo = "/platform/support", onRetry,
}: {
  loading: boolean;
  error: string;
  items: SupportTicketListItem[];
  filtered: boolean;
  returnTo?: string;
  onRetry?: () => void;
}) {
  if (loading) return <SupportLoading />;
  if (error) return <SupportFailure message={error} action={onRetry && <button type="button" onClick={onRetry}>تلاش دوباره</button>} />;
  if (!items.length) {
    return <section className="platform-support-empty" role="status">
      <span className="platform-support-empty-icon" aria-hidden="true"><i /><i /></span>
      <h2>{filtered ? "تیکتی با این فیلترها پیدا نشد." : "تیکتی در این صف وجود ندارد."}</h2>
      <p>{filtered ? "فیلترها را تغییر دهید یا پاک کنید تا تیکت‌های بیشتری ببینید." : "با ثبت تیکت تازه، گفتگوها در این فهرست نمایش داده می‌شوند."}</p>
    </section>;
  }
  return <div className="platform-support-table">
    <table aria-label="فهرست تیکت‌های پشتیبانی">
      <thead><tr><th>شناسه</th><th>کافه</th><th>موضوع</th><th>واحد</th><th>وضعیت</th><th>آخرین فعالیت</th><th>ثبت‌شده</th></tr></thead>
      <tbody>{items.map((ticket) => <tr key={ticket.id}>
        <td><Link className="platform-support-ticket-link" href={`/platform/support/${encodeURIComponent(ticket.id)}?returnTo=${encodeURIComponent(returnTo)}`}><bdi dir="ltr">{ticket.referenceNumber}</bdi></Link></td>
        <td><span className="platform-support-tenant"><strong>{ticket.tenantName}</strong><small dir="ltr"><bdi dir="ltr">{ticket.tenantSlug}</bdi></small></span></td>
        <td><Link className="platform-support-subject" href={`/platform/support/${encodeURIComponent(ticket.id)}?returnTo=${encodeURIComponent(returnTo)}`}>{ticket.subject}</Link></td>
        <td>{departmentLabel(ticket.department)}</td>
        <td><span className="platform-support-queue-status"><StatusBadge status={ticket.status} />{ticket.hasUnread && <span className="platform-support-unread">پیام تازه کافه</span>}</span></td>
        <td><time dateTime={ticket.lastActivityAt}>{formatTicketDate(ticket.lastActivityAt)}</time></td>
        <td><time dateTime={ticket.createdAt}>{formatTicketDate(ticket.createdAt)}</time></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function TicketConversation({ messages, loadAttachment }: { messages: SupportTicketMessage[]; loadAttachment?: AttachmentLoader }) {
  return <section className="platform-support-conversation" aria-labelledby="support-conversation-heading">
    <h3 id="support-conversation-heading">گفتگو <span>({new Intl.NumberFormat("fa-IR").format(messages.length)} پیام)</span></h3>
    {messages.length ? <ol className="platform-support-messages">{messages.map((message) => <li key={message.id} className={`platform-support-message platform-support-message--${message.senderType === "PLATFORM_USER" ? "platform" : "tenant"}`}>
      <header><strong>{senderLabel(message.senderType)}</strong><time dateTime={message.createdAt}>{formatTicketDate(message.createdAt)}</time></header>
      <p>{message.body}</p>
      {loadAttachment && <SupportMessageAttachments attachments={message.attachments} loadBlob={loadAttachment} />}
    </li>)}</ol> : <p className="platform-support-readonly">در این گفتگو هنوز پیامی ثبت نشده است.</p>}
  </section>;
}

function SupportFrame({ title, description, returnTo, children }: { title: string; description: string; returnTo?: string; children: ReactNode }) {
  return <main className="platform-app platform-support-app">
    <div className="platform-support-container">
      <nav className="platform-support-route-nav" aria-label="مسیرهای پشتیبانی">
        <Link href="/platform">بازگشت به پنل پلتفرم</Link>
        {returnTo && <Link href={returnTo}>بازگشت به صف تیکت‌ها</Link>}
      </nav>
      <header className="platform-support-page-heading">
        <div><p>مرکز پشتیبانی</p><h1>{title}</h1><span>{description}</span></div>
        <i className="platform-icon platform-icon-support" aria-hidden="true" />
      </header>
      {children}
    </div>
  </main>;
}

function SupportSessionState({ state }: { state: string }) {
  if (state === "loading") return <SupportLoading message="در حال بررسی دسترسی پلتفرم…" />;
  if (state === "login") return <SupportFailure message="برای ورود به مرکز پشتیبانی ابتدا وارد پنل پلتفرم شوید." action={<Link href="/platform">ورود به پنل پلتفرم</Link>} />;
  if (state === "denied") return <SupportAccessState />;
  return null;
}

function SupportAccessState() {
  return <section className="platform-support-empty" role="alert">
    <h2>دسترسی به تیکت‌ها فعال نیست.</h2>
    <p>برای مشاهده مرکز پشتیبانی، دسترسی تماشای تیکت‌ها لازم است.</p>
    <Link href="/platform">بازگشت به پنل پلتفرم</Link>
  </section>;
}

function SupportLoading({ message = "در حال دریافت تیکت‌ها…" }: { message?: string }) {
  return <p className="platform-support-state" role="status" aria-busy="true"><span className="platform-support-spinner" aria-hidden="true" />{message}</p>;
}

function SupportFailure({ message, action }: { message: string; action?: ReactNode }) {
  return <section className="platform-support-state platform-support-state--error" role="alert"><p>{message}</p>{action}</section>;
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return <span className={`platform-support-status platform-support-status--${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}

function QueuePagination({ result, filters }: { result: TicketListResponse; filters: QueueFilters }) {
  const pageCount = Math.max(1, Math.ceil(result.total / result.pageSize));
  const hrefFor = (page: number) => `/platform/support?${queueQuery({ ...filters, page })}`;
  return <nav className="platform-support-pagination" aria-label="صفحه‌های تیکت‌ها">
    <span>{new Intl.NumberFormat("fa-IR").format(result.total)} تیکت · صفحه {new Intl.NumberFormat("fa-IR").format(result.page)} از {new Intl.NumberFormat("fa-IR").format(pageCount)}</span>
    <div>
      {result.page > 1 ? <Link href={hrefFor(result.page - 1)}>صفحه قبل</Link> : <span aria-disabled="true">صفحه قبل</span>}
      {result.page < pageCount ? <Link href={hrefFor(result.page + 1)}>صفحه بعد</Link> : <span aria-disabled="true">صفحه بعد</span>}
    </div>
  </nav>;
}

function hasAdditionalFilters(filters: QueueFilters) {
  return Boolean(filters.department || filters.search.trim() || filters.tenantSearch.trim() || (filters.status && filters.status !== waitingQueue));
}
