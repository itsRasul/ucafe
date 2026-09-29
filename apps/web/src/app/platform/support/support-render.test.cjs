const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node10", target: "ES2022", jsx: "react-jsx", esModuleInterop: true },
});
const { SupportQueueBody, TicketConversation } = require("./support-client.tsx");

const render = (element) => renderToStaticMarkup(element);
const ticket = {
  id: "a-uuid", referenceNumber: "UC-10482", tenantId: "tenant-id", tenantName: "کافه دانه",
  tenantSlug: "bean-house", tenantStatus: "ACTIVE", subject: "ثبت سفارش انجام نمی‌شود",
  department: "TECHNICAL", status: "WAITING_FOR_PLATFORM", createdAt: "2026-09-29T09:00:00.000Z",
  lastActivityAt: "2026-09-29T09:30:00.000Z", lastMessageSenderType: "TENANT_USER",
};

test("Platform queue shows a loading state with live status", () => {
  const markup = render(React.createElement(SupportQueueBody, { loading: true, error: "", items: [], filtered: false }));
  assert.match(markup, /در حال دریافت تیکت‌ها/);
  assert.match(markup, /aria-busy="true"/);
});

test("Platform queue exposes safe retry guidance and distinct empty states", () => {
  const failed = render(React.createElement(SupportQueueBody, { loading: false, error: "ارتباط با سرور برقرار نشد.", items: [], filtered: false, onRetry() {} }));
  assert.match(failed, /role="alert"/);
  assert.match(failed, /ارتباط با سرور برقرار نشد/);
  assert.match(failed, /تلاش دوباره/);
  const empty = render(React.createElement(SupportQueueBody, { loading: false, error: "", items: [], filtered: false }));
  const filtered = render(React.createElement(SupportQueueBody, { loading: false, error: "", items: [], filtered: true }));
  assert.match(empty, /تیکتی در این صف وجود ندارد/);
  assert.match(filtered, /با این فیلترها پیدا نشد/);
});

test("Platform queue shows café, reference, subject, department, status, dates, and state-preserving links", () => {
  const markup = render(React.createElement(SupportQueueBody, {
    loading: false,
    error: "",
    items: [ticket],
    filtered: false,
    returnTo: "/platform/support?status=WAITING_FOR_PLATFORM&page=2",
  }));
  assert.match(markup, /UC-10482/);
  assert.match(markup, /کافه دانه/);
  assert.match(markup, /bean-house/);
  assert.match(markup, /ثبت سفارش انجام نمی‌شود/);
  assert.match(markup, /فنی/);
  assert.match(markup, /در انتظار پاسخ پشتیبانی/);
  assert.match(markup, /returnTo=%2Fplatform%2Fsupport%3Fstatus%3DWAITING_FOR_PLATFORM%26page%3D2/);
  assert.doesNotMatch(markup, />a-uuid</);
});

test("Platform conversation labels each side and safely renders plain-text message bodies", () => {
  const markup = render(React.createElement(TicketConversation, {
    messages: [
      { id: "tenant-message", senderType: "TENANT_USER", body: "مشکل ثبت سفارش", createdAt: ticket.createdAt },
      { id: "platform-message", senderType: "PLATFORM_USER", body: "<script>alert(1)</script>\nپاسخ", createdAt: ticket.lastActivityAt },
    ],
  }));
  assert.match(markup, /کافه/);
  assert.match(markup, /پشتیبانی یوکافه/);
  assert.match(markup, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
  assert.match(markup, /platform-support-message--platform/);
});
