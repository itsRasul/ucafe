const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node10", target: "ES2022", esModuleInterop: true },
});
const {
  canViewSupport, departmentLabel, formatTicketDate, queueQuery, queueReturnPath,
  senderLabel, statusLabel, supportErrorMessage, ticketDepartments, ticketStatuses, turnLabel,
} = require("./support-model.ts");

test("the support navigation shows only when the effective access projection includes view", () => {
  assert.equal(canViewSupport(["support.tickets.view"]), true);
  assert.equal(canViewSupport(["support.tickets.reply"]), false);
  assert.equal(canViewSupport(["support.tickets.manage"]), false);
  assert.equal(canViewSupport([]), false);
});

test("status, department, sender, and turn labels stay Persian and avoid raw enums", () => {
  assert.equal(statusLabel("WAITING_FOR_PLATFORM"), "در انتظار پاسخ پشتیبانی");
  assert.equal(statusLabel("WAITING_FOR_TENANT"), "در انتظار پاسخ کافه");
  assert.equal(statusLabel("CLOSED"), "بسته شده");
  assert.equal(statusLabel("UNKNOWN"), "وضعیت نامشخص");
  assert.equal(departmentLabel("TECHNICAL"), "فنی");
  assert.equal(departmentLabel("SALES"), "فروش");
  assert.equal(senderLabel("TENANT_USER"), "کافه");
  assert.equal(senderLabel("PLATFORM_USER"), "پشتیبانی یوکافه");
  assert.match(turnLabel("WAITING_FOR_PLATFORM"), /تیم پشتیبانی/);
  assert.deepEqual(ticketDepartments.map(({ value }) => value), ["TECHNICAL", "SALES"]);
  assert.deepEqual(ticketStatuses.map(({ value }) => value), ["WAITING_FOR_PLATFORM", "WAITING_FOR_TENANT", "CLOSED"]);
});

test("server queue parameters preserve filters and pagination in the detail return link", () => {
  const filters = { status: "WAITING_FOR_PLATFORM", department: "TECHNICAL", search: " UC-104 ", tenantSearch: " Bean & Brew ", page: 3 };
  const query = new URLSearchParams(queueQuery(filters));
  assert.equal(query.get("search"), "UC-104");
  assert.equal(query.get("tenantSearch"), "Bean & Brew");
  assert.equal(query.get("department"), "TECHNICAL");
  assert.equal(query.get("page"), "3");
  assert.equal(query.get("pageSize"), "25");
  assert.equal(queueReturnPath(filters), "/platform/support?" + queueQuery(filters));
  assert.equal(new URLSearchParams(queueQuery({ ...filters, page: 0 })).get("page"), "1");
});

test("support errors are mapped to safe user-facing copy", () => {
  assert.match(supportErrorMessage({ status: 403 }), /اجازه دسترسی/);
  assert.match(supportErrorMessage({ status: 404 }), /پیدا نشد/);
  assert.match(supportErrorMessage({ status: 409 }), /وضعیت تیکت تغییر کرده/);
  assert.match(supportErrorMessage(new Error("SQL details")), /ارتباط با سرور/);
  assert.match(formatTicketDate("not-a-date"), /—/);
});
