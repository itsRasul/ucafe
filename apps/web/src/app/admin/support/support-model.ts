import { supportMessageBody } from "../../support-attachment-model";
import type { SupportAttachment } from "../../support-attachment-model";

export type TicketDepartment = "TECHNICAL" | "SALES";
export type TicketStatus = "WAITING_FOR_PLATFORM" | "WAITING_FOR_TENANT" | "CLOSED";
export type TicketCloseReason = "MANUAL" | "INACTIVITY";
export type TicketSender = "TENANT_USER" | "PLATFORM_USER";
export type TicketAttachment = SupportAttachment;

export type TicketMessage = { id: string; senderType: TicketSender; body: string; createdAt: string; attachments?: TicketAttachment[] };
export type TicketSummary = {
  id: string;
  referenceNumber: string;
  subject: string;
  department: TicketDepartment;
  status: TicketStatus;
  createdAt: string;
  lastActivityAt: string;
  lastMessageSenderType: TicketSender;
  hasUnread: boolean;
};
export type TicketDetail = TicketSummary & {
  closeReason: TicketCloseReason | null;
  closedAt: string | null;
  lastPlatformReplyAt: string | null;
  updatedAt: string;
  messages: TicketMessage[];
};
export type TicketPage = { items: TicketSummary[]; total: number; page: number; pageSize: number };
export type NewTicket = { department: TicketDepartment | ""; subject: string; message: string };
export type TicketField = keyof NewTicket;
export type TicketErrors = Partial<Record<TicketField, string>>;
export type TenantApi = <T>(path: string, init?: RequestInit) => Promise<T>;

export const departments: ReadonlyArray<{ value: TicketDepartment; label: string }> = [
  { value: "TECHNICAL", label: "فنی" },
  { value: "SALES", label: "فروش" },
];
export const emptyTicketTitle = "هنوز تیکتی ثبت نکرده‌اید";
export const emptyTicketDescription = "اگر برای استفاده از یوکافه به راهنمایی نیاز دارید، پیام خود را برای تیم پشتیبانی بفرستید.";

export function departmentLabel(department: string) {
  return departments.find((item) => item.value === department)?.label ?? "واحد پشتیبانی";
}

export function statusLabel(status: string) {
  switch (status) {
    case "WAITING_FOR_PLATFORM": return "در انتظار پاسخ پشتیبانی";
    case "WAITING_FOR_TENANT": return "در انتظار پاسخ شما";
    case "CLOSED": return "بسته شده";
    default: return "وضعیت نامشخص";
  }
}

export function statusMessage(status: TicketStatus) {
  switch (status) {
    case "WAITING_FOR_PLATFORM": return "پیام شما ارسال شده و در انتظار پاسخ پشتیبانی است.";
    case "WAITING_FOR_TENANT": return "پشتیبانی پاسخ داده و منتظر پیام شماست.";
    case "CLOSED": return "این تیکت بسته شده است.";
  }
}

export function senderLabel(sender: TicketSender) {
  return sender === "PLATFORM_USER" ? "پشتیبانی یوکافه" : "شما";
}

export function senderSide(sender: TicketSender) {
  return sender === "PLATFORM_USER" ? "platform" : "tenant";
}

export function canReply(status: TicketStatus, closeReason: TicketCloseReason | null) {
  return status !== "CLOSED" || closeReason === "INACTIVITY";
}

export function validateTicketForm(input: NewTicket): TicketErrors {
  const errors: TicketErrors = {};
  if (!departments.some(({ value }) => value === input.department)) errors.department = "واحد پشتیبانی را انتخاب کنید.";
  const subject = input.subject.trim();
  if (!subject) errors.subject = "موضوع را وارد کنید.";
  else if (subject.length > 160) errors.subject = "موضوع نباید بیشتر از ۱۶۰ نویسه باشد.";
  const message = input.message.trim();
  if (!message) errors.message = "متن پیام را وارد کنید.";
  else if (message.length > 10000) errors.message = "متن پیام نباید بیشتر از ۱۰٬۰۰۰ نویسه باشد.";
  return errors;
}

export function validateReply(message: string) {
  const trimmed = message.trim();
  if (!trimmed) return "متن پیام را وارد کنید.";
  if (trimmed.length > 10000) return "متن پیام نباید بیشتر از ۱۰٬۰۰۰ نویسه باشد.";
  return "";
}

export async function createTicket(api: TenantApi, input: NewTicket, files: File[] = []) {
  const payload = { department: input.department as TicketDepartment, subject: input.subject.trim(), message: input.message.trim() };
  return api<TicketDetail>("/tenant/support/tickets", { method: "POST", body: supportMessageBody(payload, files) });
}

export async function replyToTicket(api: TenantApi, ticketId: string, message: string, files: File[] = []) {
  return api<TicketDetail>(`/tenant/support/tickets/${encodeURIComponent(ticketId)}/messages`, {
    method: "POST",
    body: supportMessageBody({ message: message.trim() }, files),
  });
}

export async function runWhilePending(lock: { current: boolean }, action: () => Promise<void>) {
  if (lock.current) return;
  lock.current = true;
  try { await action(); }
  finally { lock.current = false; }
}

export function supportErrorMessage(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
  if (status === 401) return "برای ادامه دوباره وارد شوید.";
  if (status === 403) return "نقش شما اجازه استفاده از بخش پشتیبانی را ندارد.";
  if (status === 413) return "حجم هر فایل نباید بیشتر از ۸ مگابایت باشد.";
  if (status === 503) return "ذخیره پیوست‌ها موقتاً در دسترس نیست. دوباره تلاش کنید.";
  if (status === 404) return "این تیکت پیدا نشد یا دیگر در دسترس شما نیست.";
  if (status === 409) return "وضعیت تیکت تغییر کرده است؛ گفت‌وگو را بررسی کنید.";
  if (status === 400 || status === 422) return "اطلاعات واردشده معتبر نیست. آن‌ها را بررسی و دوباره تلاش کنید.";
  return "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}

export function formatTicketDate(value: string, timeZone?: string) {
  return new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short", ...(timeZone ? { timeZone } : {}) }).format(new Date(value));
}

export function ticketListPresentation(ticket: TicketSummary, timeZone?: string) {
  return {
    reference: ticket.referenceNumber,
    subject: ticket.subject,
    department: departmentLabel(ticket.department),
    status: statusLabel(ticket.status),
    activity: `آخرین فعالیت · ${formatTicketDate(ticket.lastActivityAt, timeZone)}`,
  };
}
