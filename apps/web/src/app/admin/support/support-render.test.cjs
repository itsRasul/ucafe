const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node10", target: "ES2022", jsx: "react-jsx", esModuleInterop: true },
});
const { ClosedTicketNotice, EmptySupportTickets, SupportTicketCards, SupportTicketMessages, SupportTicketFields } = require("./support-client.tsx");
const { SupportFilePicker } = require("../../support-attachments.tsx");

const render = (element) => renderToStaticMarkup(element);
const ticket = {
  id: "ticket-id", referenceNumber: "UC-10482", subject: "مشکل در ثبت سفارش آنلاین", department: "TECHNICAL",
  status: "WAITING_FOR_TENANT", createdAt: "2026-09-29T09:00:00.000Z", lastActivityAt: "2026-09-29T09:30:00.000Z",
  lastMessageSenderType: "PLATFORM_USER",
};

test("empty state renders its create action", () => {
  const markup = render(React.createElement(EmptySupportTickets));
  assert.match(markup, /هنوز تیکتی ثبت نکرده‌اید/);
  assert.match(markup, /href="\/admin\/support\/new"/);
  assert.match(markup, /ثبت تیکت جدید/);
});

test("ticket card renders reference, subject, department, status, time, and a full-card link", () => {
  const markup = render(React.createElement(SupportTicketCards, { tickets: [ticket], timeZone: "Asia/Tehran" }));
  assert.match(markup, /href="\/admin\/support\/ticket-id"/);
  assert.match(markup, /UC-10482/);
  assert.match(markup, /مشکل در ثبت سفارش آنلاین/);
  assert.match(markup, /فنی/);
  assert.match(markup, /در انتظار پاسخ شما/);
  assert.match(markup, /آخرین فعالیت/);
});

test("create controls have visible labels, required state, backend limits, and linked inline errors", () => {
  const markup = render(React.createElement(SupportTicketFields, {
    input: { department: "", subject: "", message: "" },
    errors: { department: "واحد پشتیبانی را انتخاب کنید.", subject: "موضوع را وارد کنید.", message: "متن پیام را وارد کنید." },
    onChange() {}, onBlur() {},
  }));
  assert.match(markup, /<select[^>]+required=""/);
  assert.match(markup, /id="ticket-subject"[^>]+required=""[^>]+maxLength="160"/i);
  assert.match(markup, /id="ticket-message"[^>]+required=""[^>]+maxLength="10000"/i);
  assert.match(markup, /aria-describedby="ticket-subject-error"/);
  assert.match(markup, /aria-describedby="ticket-message-error"/);
  assert.match(markup, /موضوع را وارد کنید/);
});

test("file picker renders selected names, removal controls, restrictions, and disabled upload state", () => {
  const file = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });
  const markup = render(React.createElement(SupportFilePicker, { files: [file], onChange() {}, disabled: true }));
  assert.match(markup, /type="file"[^>]+multiple=""[^>]+accept="image\/jpeg,image\/png,image\/webp,application\/pdf"[^>]+disabled=""/);
  assert.match(markup, /report\.pdf/);
  assert.match(markup, /حذف پیوست report\.pdf/);
  assert.match(markup, /حداکثر ۵ فایل/);
});

test("conversation messages show the sender role and render untrusted bodies as plain text", () => {
  const markup = render(React.createElement(SupportTicketMessages, {
    timeZone: "Asia/Tehran",
    messages: [
      { id: "tenant", senderType: "TENANT_USER", body: "شروع گفتگو", createdAt: ticket.createdAt },
      { id: "platform", senderType: "PLATFORM_USER", body: "<script>alert(1)</script>", createdAt: ticket.lastActivityAt },
    ],
  }));
  assert.match(markup, /support-message--tenant/);
  assert.match(markup, /شما/);
  assert.match(markup, /support-message--platform/);
  assert.match(markup, /پشتیبانی یوکافه/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("conversation attachment metadata renders safe preview and download actions", () => {
  const markup = render(React.createElement(SupportTicketMessages, {
    timeZone: "Asia/Tehran",
    loadAttachment: async () => new Blob(["image"]),
    messages: [{ id: "file-message", senderType: "PLATFORM_USER", body: "بررسی شد", createdAt: ticket.lastActivityAt, attachments: [
      { id: "image-id", originalFilename: "screenshot.png", detectedMimeType: "image/png", sizeBytes: 2048, contentUrl: "/tenant/support/tickets/ticket-id/attachments/image-id/content" },
    ] }],
  }));
  assert.match(markup, /screenshot\.png/);
  assert.match(markup, /پیش‌نمایش/);
  assert.match(markup, /دانلود/);
  assert.match(markup, /تصویر/);
});

test("manual closed state renders an explanation and a new-ticket action", () => {
  const markup = render(React.createElement(ClosedTicketNotice, { manual: true }));
  assert.match(markup, /به‌صورت دستی بسته شده/);
  assert.match(markup, /href="\/admin\/support\/new"/);
});
