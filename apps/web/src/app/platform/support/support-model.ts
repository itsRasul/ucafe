import type { SupportAttachment } from "../../support-attachment-model";

export const ticketStatuses = [
  { value: "WAITING_FOR_PLATFORM", label: "در انتظار پاسخ پشتیبانی" },
  { value: "WAITING_FOR_TENANT", label: "در انتظار پاسخ کافه" },
  { value: "CLOSED", label: "بسته شده" },
] as const;

export const ticketDepartments = [
  { value: "TECHNICAL", label: "فنی" },
  { value: "SALES", label: "فروش" },
] as const;

export type TicketStatus = (typeof ticketStatuses)[number]["value"];
export type TicketDepartment = (typeof ticketDepartments)[number]["value"];

export type QueueFilters = {
  status: string;
  department: string;
  search: string;
  tenantSearch: string;
  page: number;
};

export type SupportTicketListItem = {
  id: string;
  referenceNumber: string;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  subject: string;
  department: TicketDepartment;
  status: TicketStatus;
  createdAt: string;
  attachments?: SupportAttachment[];
  lastActivityAt: string;
  lastMessageSenderType: "TENANT_USER" | "PLATFORM_USER";
};

export type SupportTicketMessage = {
  id: string;
  senderType: "TENANT_USER" | "PLATFORM_USER";
  body: string;
  createdAt: string;
  attachments?: SupportAttachment[];
};

export type SupportTicketDetail = SupportTicketListItem & {
  closeReason: "MANUAL" | "INACTIVITY" | null;
  closedAt: string | null;
  lastPlatformReplyAt: string | null;
  updatedAt: string;
  tenant: { id: string; name: string; slug: string; status: string };
  messages: SupportTicketMessage[];
};

export type TicketListResponse = {
  items: SupportTicketListItem[];
  total: number;
  page: number;
  pageSize: number;
};

export function canViewSupport(permissions: string[]) {
  return permissions.includes("support.tickets.view");
}

export function statusLabel(status: string) {
  return ticketStatuses.find((item) => item.value === status)?.label ?? "وضعیت نامشخص";
}

export function departmentLabel(department: string) {
  return ticketDepartments.find((item) => item.value === department)?.label ?? "واحد پشتیبانی";
}

export function senderLabel(senderType: SupportTicketMessage["senderType"]) {
  return senderType === "PLATFORM_USER" ? "پشتیبانی یوکافه" : "کافه";
}

export function turnLabel(status: TicketStatus) {
  if (status === "WAITING_FOR_PLATFORM") return "نوبت پاسخ با تیم پشتیبانی یوکافه است.";
  if (status === "WAITING_FOR_TENANT") return "نوبت پاسخ با کافه است.";
  return "این تیکت بسته شده است.";
}

export function formatTicketDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("fa-IR", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function supportErrorMessage(error: unknown) {
  const status = (error as { status?: number } | null)?.status;
  if (status === 400) return "اطلاعات فیلتر یا درخواست معتبر نیست.";
  if (status === 403) return "این حساب اجازه دسترسی به تیکت‌ها را ندارد.";
  if (status === 413) return "حجم هر فایل نباید بیشتر از ۸ مگابایت باشد.";
  if (status === 503) return "ذخیره پیوست‌ها موقتاً در دسترس نیست. دوباره تلاش کنید.";
  if (status === 404) return "تیکت پیدا نشد یا دیگر در دسترس نیست.";
  if (status === 409) return "وضعیت تیکت تغییر کرده است. اطلاعات تازه شد؛ دوباره بررسی کنید.";
  return "ارتباط با سرور برقرار نشد. دوباره تلاش کنید.";
}

export function queueQuery(filters: QueueFilters) {
  const query = new URLSearchParams();
  if (filters.status) query.set("status", filters.status);
  if (filters.department) query.set("department", filters.department);
  if (filters.search.trim()) query.set("search", filters.search.trim());
  if (filters.tenantSearch.trim()) query.set("tenantSearch", filters.tenantSearch.trim());
  query.set("page", String(Math.max(1, filters.page)));
  query.set("pageSize", "25");
  return query.toString();
}

export function queueReturnPath(filters: QueueFilters) {
  return "/platform/support?" + queueQuery(filters);
}
