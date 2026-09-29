const assert = require("node:assert/strict");
const test = require("node:test");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "CommonJS", moduleResolution: "Node10", target: "ES2022", esModuleInterop: true },
});
const {
  canReply, createTicket, departmentLabel, departments, emptyTicketDescription,
  emptyTicketTitle, replyToTicket, runWhilePending, senderLabel, senderSide,
  statusLabel, statusMessage, supportErrorMessage, ticketListPresentation,
  validateReply, validateTicketForm,
} = require("./support-model.ts");
const { addSupportFiles, removeSupportFile, supportAttachmentMaxBytes } = require("../../support-attachment-model.ts");

const ticket = {
  id: "ticket-id",
  referenceNumber: "UC-10482",
  subject: "مشکل در ثبت سفارش آنلاین",
  department: "TECHNICAL",
  status: "WAITING_FOR_TENANT",
  closeReason: null,
  createdAt: "2026-09-29T09:00:00.000Z",
  lastActivityAt: "2026-09-29T09:30:00.000Z",
  lastMessageSenderType: "PLATFORM_USER",
  lastPlatformReplyAt: "2026-09-29T09:30:00.000Z",
  updatedAt: "2026-09-29T09:30:00.000Z",
  messages: [],
};

test("empty ticket state has a useful message and the department selector exposes backend values", () => {
  assert.match(emptyTicketTitle, /تیکتی/);
  assert.match(emptyTicketDescription, /پشتیبانی/);
  assert.deepEqual(departments, [{ value: "TECHNICAL", label: "فنی" }, { value: "SALES", label: "فروش" }]);
});

test("ticket list presentation includes reference, subject, department, status, and latest activity", () => {
  const presentation = ticketListPresentation(ticket);
  assert.equal(presentation.reference, "UC-10482");
  assert.equal(presentation.subject, ticket.subject);
  assert.equal(presentation.department, "فنی");
  assert.equal(presentation.status, "در انتظار پاسخ شما");
  assert.match(presentation.activity, /آخرین فعالیت/);
});

test("status and department enums map to Persian labels, never raw enum values", () => {
  assert.equal(statusLabel("WAITING_FOR_PLATFORM"), "در انتظار پاسخ پشتیبانی");
  assert.equal(statusLabel("WAITING_FOR_TENANT"), "در انتظار پاسخ شما");
  assert.equal(statusLabel("CLOSED"), "بسته شده");
  assert.equal(statusLabel("NEW_STATUS"), "وضعیت نامشخص");
  assert.equal(departmentLabel("SALES"), "فروش");
  assert.equal(departmentLabel("NEW_DEPARTMENT"), "واحد پشتیبانی");
});

test("create and reply validation trims whitespace and matches backend length limits", () => {
  assert.deepEqual(validateTicketForm({ department: "", subject: "  ", message: "\n " }), {
    department: "واحد پشتیبانی را انتخاب کنید.", subject: "موضوع را وارد کنید.", message: "متن پیام را وارد کنید.",
  });
  assert.deepEqual(validateTicketForm({ department: "TECHNICAL", subject: ` ${"x".repeat(160)} `, message: ` ${"y".repeat(10000)} ` }), {});
  assert.ok(validateTicketForm({ department: "TECHNICAL", subject: "x".repeat(161), message: "ok" }).subject);
  assert.ok(validateTicketForm({ department: "TECHNICAL", subject: "ok", message: "x".repeat(10001) }).message);
  assert.equal(validateReply("   "), "متن پیام را وارد کنید.");
  assert.equal(validateReply(` ${"x".repeat(10000)} `), "");
});

test("create uses the tenant endpoint and sends only trimmed user fields", async () => {
  const calls = [];
  const api = async (path, init) => { calls.push({ path, init }); return { ...ticket, id: "created-id" }; };
  const created = await createTicket(api, { department: "SALES", subject: "  پرسش فروش  ", message: "  شرح درخواست  " });
  assert.equal(created.id, "created-id");
  assert.equal(calls[0].path, "/tenant/support/tickets");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), { department: "SALES", subject: "پرسش فروش", message: "شرح درخواست" });
  assert.equal("tenantId" in JSON.parse(calls[0].init.body), false);
});

test("create and reply carry selected files in the existing multipart request", async () => {
  const file = new File(["%PDF-1.7"], "report.pdf", { type: "application/pdf" });
  const calls = [];
  const api = async (path, init) => { calls.push({ path, init }); return ticket; };
  await createTicket(api, { department: "TECHNICAL", subject: " Report ", message: " Details " }, [file]);
  assert.ok(calls[0].init.body instanceof FormData);
  assert.equal(calls[0].init.body.get("subject"), "Report");
  assert.equal(calls[0].init.body.getAll("files")[0].name, "report.pdf");
  await replyToTicket(api, "ticket-id", " follow up ", [file]);
  assert.equal(calls[1].path, "/tenant/support/tickets/ticket-id/messages");
  assert.equal(calls[1].init.body.get("message"), "follow up");
  assert.equal(calls[1].init.body.getAll("files").length, 1);
});

test("file selection validates type, size, and message file count, and supports removal", () => {
  const accepted = Array.from({ length: 5 }, (_, index) => new File(["%PDF-1.7"], `file-${index}.pdf`, { type: "application/pdf" }));
  const selected = addSupportFiles([], accepted);
  assert.equal(selected.files.length, 5);
  assert.equal(addSupportFiles(selected.files, [accepted[0]]).error, "حداکثر ۵ فایل می‌توانید ارسال کنید.");
  assert.equal(addSupportFiles([], [new File([new Uint8Array(supportAttachmentMaxBytes + 1)], "large.pdf", { type: "application/pdf" })]).error, "حجم هر فایل نباید بیشتر از ۸ مگابایت باشد.");
  assert.equal(addSupportFiles([], [new File(["<svg/>"] , "active.svg", { type: "image/svg+xml" })]).error, "این نوع فایل پشتیبانی نمی‌شود.");
  assert.deepEqual(removeSupportFile(selected.files, 2), [...selected.files.slice(0, 2), ...selected.files.slice(3)]);
});

test("pending submission guard drops a second create/reply while the first request is unresolved", async () => {
  const lock = { current: false };
  let calls = 0;
  let finish;
  const first = runWhilePending(lock, async () => { calls += 1; await new Promise((resolve) => { finish = resolve; }); });
  await runWhilePending(lock, async () => { calls += 1; });
  assert.equal(calls, 1);
  finish();
  await first;
  assert.equal(lock.current, false);
});

test("tenant and platform messages have distinct display labels and sides", () => {
  assert.equal(senderLabel("TENANT_USER"), "شما");
  assert.equal(senderLabel("PLATFORM_USER"), "پشتیبانی یوکافه");
  assert.equal(senderSide("TENANT_USER"), "tenant");
  assert.equal(senderSide("PLATFORM_USER"), "platform");
});

test("reply posts the trimmed body to the selected ticket and returns updated state", async () => {
  const calls = [];
  const updated = { ...ticket, status: "WAITING_FOR_PLATFORM", messages: [{ id: "reply-id", senderType: "TENANT_USER", body: "توضیح تکمیلی", createdAt: ticket.lastActivityAt }] };
  const api = async (path, init) => { calls.push({ path, init }); return updated; };
  assert.equal(await replyToTicket(api, "ticket-id", "  توضیح تکمیلی  "), updated);
  assert.equal(calls[0].path, "/tenant/support/tickets/ticket-id/messages");
  assert.deepEqual(JSON.parse(calls[0].init.body), { message: "توضیح تکمیلی" });
  assert.equal(updated.status, "WAITING_FOR_PLATFORM");
  assert.match(statusMessage(updated.status), /در انتظار پاسخ پشتیبانی/);
});

test("manual closed tickets cannot be replied to; inactivity closures can be reopened by tenant reply", () => {
  assert.equal(canReply("WAITING_FOR_PLATFORM", null), true);
  assert.equal(canReply("WAITING_FOR_TENANT", null), true);
  assert.equal(canReply("CLOSED", "MANUAL"), false);
  assert.equal(canReply("CLOSED", "INACTIVITY"), true);
});

test("known API errors show safe Persian guidance", () => {
  assert.match(supportErrorMessage({ status: 404 }), /پیدا نشد/);
  assert.match(supportErrorMessage({ status: 403 }), /اجازه/);
  assert.match(supportErrorMessage({ status: 409 }), /بسته/);
  assert.match(supportErrorMessage(new Error("database password and stack")), /ارتباط با سرور/);
});
