import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { BadRequestException, Controller, Get, InternalServerErrorException, Logger, Module, Param, Req } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import * as Sentry from "@sentry/nestjs";
import { SentryModule } from "@sentry/nestjs/setup";
import type { ErrorEvent, Event, Log } from "@sentry/nestjs";
import { getSentryOptions, getTraceSampleRate, isExcludedTracePath } from "./sentry-options";
import { sanitizeSentryEvent, sanitizeSentryLog, sanitizeSentrySpan, sanitizeSentryTransaction } from "./sentry-privacy";
import { UcafeSentryGlobalFilter } from "./sentry-global.filter";
import { canonicalRequestId, featureForPath, setTenantObservabilityContext } from "./request-context";
import { requestObservability } from "./request-observability.middleware";
import { logOperationalFailure } from "./operational-logger";

test("Sentry config stays disabled in tests and keeps environment/release configurable", () => {
  assert.equal(getSentryOptions({ NODE_ENV: "test", SENTRY_DSN: "https://public@example.test/1" }).dsn, undefined);
  assert.equal(getSentryOptions({ NODE_ENV: "development" }).dsn, undefined);
  const options = getSentryOptions({ NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "abc123" });
  assert.equal(options.environment, "production");
  assert.equal(options.release, "abc123");
  assert.doesNotThrow(() => Sentry.init(getSentryOptions({ NODE_ENV: "production", SENTRY_DSN: "not-a-sentry-dsn" })));
});

test("trace sampling is conservative, validates configuration, excludes noise, and blocks API propagation", () => {
  assert.equal(getTraceSampleRate("production"), 0.05);
  assert.equal(getTraceSampleRate("development"), 1);
  assert.equal(getTraceSampleRate("test"), 0);
  assert.equal(getTraceSampleRate("production", "0.2"), 0.2);
  assert.equal(getTraceSampleRate("production", "not-a-rate"), 0);
  assert.equal(getTraceSampleRate("production", "1.01"), 0);
  for (const path of ["/health", "GET /api/v1/health", "https://ucafe.test/api/v1/health/ready", "/_next/static/chunk.js", "/favicon.ico", "/monitoring"]) {
    assert.equal(isExcludedTracePath(path), true, path);
  }
  assert.equal(isExcludedTracePath("GET /api/v1/public/menu"), false);

  const options = getSentryOptions({ NODE_ENV: "production", SENTRY_DSN: "https://public@example.test/1" });
  assert.deepEqual(options.tracePropagationTargets, []);
  assert.equal(options.tracesSampler?.({ name: "GET /api/v1/health", inheritOrSampleWith: () => 0.05 }), 0);
  assert.equal(options.tracesSampler?.({ name: "GET /api/v1/public/menu", inheritOrSampleWith: (rate) => rate }), 0.05);
  assert.equal(getSentryOptions({ NODE_ENV: "production", SENTRY_DSN: "https://public@example.test/1", SENTRY_TRACES_SAMPLE_RATE: "bad" }).tracesSampler, undefined);
});

test("span and transaction sanitizers retain safe diagnostics and trace/request correlation only", () => {
  const span = {
    trace_id: "a".repeat(32), span_id: "b".repeat(16), start_timestamp: 1, timestamp: 2,
    op: "db.query", description: "SELECT phone FROM clients WHERE phone='09121234567'",
    data: {
      "db.system": "postgresql", "db.operation.name": "SELECT", "db.statement": "phone='09121234567'",
      "http.route": "/api/v1/orders/123e4567-e89b-42d3-a456-426614174000?phone=09121234567",
      "http.response.status_code": 200, "url.full": "https://tenant.test/orders?email=person@example.test",
    },
  };
  const safeSpan = sanitizeSentrySpan(span);
  const tenantId = "123e4567-e89b-42d3-a456-426614174001";
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const transaction = sanitizeSentryTransaction({
    type: "transaction", transaction: `/api/v1/orders/${requestId}?phone=09121234567`,
    request: { url: "https://tenant.test/orders?phone=09121234567" },
    user: { id: "client-1", email: "person@example.test" }, extra: { note: "customer note" },
    tags: { tenant_id: tenantId, feature: "orders", phone: "09121234567" },
    contexts: { request: { id: requestId }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) }, private: { text: "private" } },
    spans: [span],
  });
  assert.equal(safeSpan.description, "postgresql select");
  assert.deepEqual(safeSpan.data, { "db.system": "postgresql", "db.operation.name": "select", "http.route": "/api/v1/orders/:id", "http.response.status_code": 200 });
  assert.equal(transaction.transaction, "/api/v1/orders/:id");
  assert.deepEqual(transaction.tags, { tenant_id: tenantId, feature: "orders" });
  assert.deepEqual(transaction.contexts, { request: { id: requestId }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) } });
  const serialized = JSON.stringify(transaction);
  for (const secret of ["09121234567", "person@example.test", "customer note", "private", "db.statement", "url.full"]) assert.ok(!serialized.includes(secret));
});

test("Sentry event sanitizer removes request/user context and redacts identifiers in error text", () => {
  const event: ErrorEvent = {
    type: undefined,
    message: "phone=09120000000 email=person@example.test access_token=secret-value",
    request: { url: "https://tenant.example.test/api/orders/123?phone=09120000000", headers: { authorization: "Bearer secret-value" } },
    user: { id: "client-1", email: "person@example.test" },
    extra: { note: "private customer note" },
    tags: { tenant_id: "tenant-1" },
    breadcrumbs: [{ message: "cookie=session-secret" }],
    transaction: "/api/orders/123",
  };

  const sanitized = sanitizeSentryEvent(event);
  const serialized = JSON.stringify(sanitized);
  assert.equal(sanitized.request, undefined);
  assert.equal(sanitized.user, undefined);
  assert.equal(sanitized.extra, undefined);
  assert.equal(sanitized.tags, undefined);
  assert.equal(sanitized.breadcrumbs, undefined);
  assert.equal(sanitized.transaction, undefined);
  assert.ok(!serialized.includes("09120000000"));
  assert.ok(!serialized.includes("person@example.test"));
  assert.ok(!serialized.includes("secret-value"));
  assert.ok(!serialized.includes("private customer note"));
  assert.ok(sanitized.message?.includes("[Phone]"));
});

test("Sentry allowlists safe correlation metadata and strips synthetic PII from events and logs", () => {
  const requestId = "123e4567-e89b-42d3-a456-426614174000";
  const tenantId = "123e4567-e89b-42d3-a456-426614174001";
  const event: ErrorEvent = {
    type: undefined,
    message: "09121234567 user@example.test Bearer synthetic-token OTP 123456 password=secret cookie=session-secret jwt=eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.signature12345",
    request: { url: "https://tenant.example.test/api/orders?phone=09121234567" },
    contexts: { request: { id: requestId, url: "https://tenant.example.test/?email=user@example.test" }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) }, private: { note: "ticket text" } },
    tags: { tenant_id: tenantId, feature: "orders", actor_role: "tenant_owner", client_id: tenantId, phone: "09121234567" },
  };
  const sanitized = sanitizeSentryEvent(event);
  assert.deepEqual(sanitized.tags, { tenant_id: tenantId, feature: "orders", actor_role: "tenant_owner" });
  assert.deepEqual(sanitized.contexts, { request: { id: requestId }, trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) } });
  const serialized = JSON.stringify(sanitized);
  for (const secret of ["09121234567", "user@example.test", "synthetic-token", "secret", "session-secret", "123456", "signature12345", "ticket text"]) {
    assert.ok(!serialized.includes(secret), `sanitized event contains ${secret}`);
  }

  const log: Log = {
    level: "warn",
    message: "OTP 123456 sent to user@example.test phone 09121234567",
    attributes: { feature: "notifications", integration: "sms_ir", tenant_id: tenantId, request_id: requestId, client_id: tenantId, cookie: "session-secret" },
  };
  const safeLog = sanitizeSentryLog(log);
  assert.ok(safeLog);
  assert.deepEqual(safeLog.attributes, { feature: "notifications", integration: "sms_ir", tenant_id: tenantId, request_id: requestId });
  for (const secret of ["09121234567", "user@example.test", "123456", "session-secret"]) assert.ok(!JSON.stringify(safeLog).includes(secret));
});

test("request IDs accept only UUIDv4 and feature mapping uses route families", () => {
  const valid = "123e4567-e89b-42d3-a456-426614174000";
  assert.equal(canonicalRequestId(valid), valid);
  assert.match(canonicalRequestId(undefined), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  for (const unsafe of ["09121234567", "customer@example.test", "Bearer abc.def.ghi", "../../secret", "x".repeat(500)]) {
    assert.notEqual(canonicalRequestId(unsafe), unsafe);
  }
  assert.equal(featureForPath("/api/v1/tenant/orders/123?phone=09121234567"), "orders");
  assert.equal(featureForPath("/api/v1/platform/crm/leads"), "platform_crm");
});

@Controller()
class SentrySyntheticController {
  @Get("success")
  success() { return { created: true }; }

  @Get("traced-success")
  tracedSuccess() { return Sentry.startSpan({ name: "synthetic lookup", op: "function" }, () => ({ created: true })); }

  @Get("expected")
  expected() { throw new BadRequestException(); }

  @Get("unexpected")
  unexpected() { throw new Error("phone=09120000000 email=person@example.test Bearer synthetic-access-token"); }

  @Get("http-500")
  http500() { throw new InternalServerErrorException("synthetic internal failure"); }
}

@Module({
  imports: [SentryModule.forRoot()],
  controllers: [SentrySyntheticController],
  providers: [{ provide: APP_FILTER, useClass: UcafeSentryGlobalFilter }],
})
class SentrySyntheticModule {}

@Controller()
class RequestContextSyntheticController {
  @Get("tenant/orders/:tenantId")
  async tenant(@Param("tenantId") tenantId: string) {
    setTenantObservabilityContext(tenantId);
    await new Promise((resolve) => setTimeout(resolve, tenantId.endsWith("1") ? 7 : 2));
    Sentry.captureMessage(`synthetic tenant observation ${tenantId}`);
    return { tenantId };
  }

  @Get("platform")
  platform(@Req() request: { get: (name: string) => string | undefined }) {
    Sentry.captureMessage("synthetic platform observation");
    return { requestId: request.get("x-request-id") };
  }
}

@Module({ imports: [SentryModule.forRoot()], controllers: [RequestContextSyntheticController] })
class RequestContextSyntheticModule {}

test("request correlation and concurrent tenant scopes stay isolated from platform requests", async () => {
  const captured: Event[] = [];
  Sentry.init({
    ...getSentryOptions({ NODE_ENV: "test" }),
    dsn: "https://public@example.test/1",
    transport: () => ({
      send: async (envelope) => {
        for (const [headers, payload] of envelope[1]) if (headers.type === "event") captured.push(payload as Event);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });
  const app = await NestFactory.create(RequestContextSyntheticModule, { logger: false });
  app.use(requestObservability);
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const tenantA = "123e4567-e89b-42d3-a456-426614174001";
  const tenantB = "123e4567-e89b-42d3-a456-426614174002";
  const expected = new Map<string, string>();

  try {
    await Promise.all(Array.from({ length: 16 }, async (_, index) => {
      const requestId = `123e4567-e89b-42d3-a456-${String(index + 100).padStart(12, "0")}`;
      const tenantId = index % 2 ? tenantA : tenantB;
      expected.set(requestId, tenantId);
      const response = await fetch(`${origin}/tenant/orders/${tenantId}`, { headers: { "x-request-id": requestId } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("x-request-id"), requestId);
    }));

    const platform = await fetch(`${origin}/platform`, { headers: { "x-request-id": "09121234567" } });
    assert.equal(platform.status, 200);
    const generatedId = platform.headers.get("x-request-id");
    assert.ok(generatedId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(generatedId));
    assert.notEqual(generatedId, "09121234567");
    const missingId = await fetch(`${origin}/platform`);
    assert.equal(missingId.status, 200);
    assert.ok(missingId.headers.get("x-request-id"));

    await Sentry.flush(2000);
    const tenantEvents = captured.filter((event) => event.message?.startsWith("synthetic tenant observation"));
    assert.equal(tenantEvents.length, expected.size);
    for (const event of tenantEvents) {
      const requestId = (event.contexts?.request as { id?: string } | undefined)?.id;
      assert.ok(requestId && expected.has(requestId));
      assert.equal(event.tags?.tenant_id, expected.get(requestId));
      assert.equal(event.tags?.feature, "orders");
      assert.equal(event.tags?.actor_role, "anonymous");
    }
    const platformEvents = captured.filter((event) => event.message === "synthetic platform observation");
    assert.equal(platformEvents.length, 2);
    for (const event of platformEvents) {
      assert.equal(event.tags?.tenant_id, undefined);
      assert.equal(event.tags?.feature, "platform");
      assert.equal(event.tags?.actor_role, "anonymous");
    }
  } finally {
    await app.close();
    await Sentry.close(2000);
  }
});

test("selected structured logs stay local-first and Sentry log transport is non-blocking and fail-open", async () => {
  type Mode = "failed" | "slow";
  let mode: Mode = "failed";
  let onSendStarted = () => {};
  let sendStarted = new Promise<void>((resolve) => { onSendStarted = resolve; });
  let releaseSlowSend: ((response: { statusCode: number }) => void) | undefined;
  const sentLogs: unknown[] = [];
  const localLogs: string[] = [];
  const tenantId = "123e4567-e89b-42d3-a456-426614174001";
  const logger = {
    warn: (message: string) => localLogs.push(message),
    error: (message: string) => localLogs.push(message),
  } as unknown as Logger;

  Sentry.init({
    ...getSentryOptions({ NODE_ENV: "test" }),
    dsn: "https://public@example.test/1",
    transport: () => ({
      send: (envelope) => {
        for (const [headers, payload] of envelope[1]) if (headers.type === "log") sentLogs.push(payload);
        onSendStarted();
        if (mode === "failed") return Promise.reject(new Error("synthetic log transport failure"));
        return new Promise((resolve) => { releaseSlowSend = resolve; });
      },
      flush: async () => true,
    }),
  });

  try {
    assert.doesNotThrow(() => logOperationalFailure(logger, "warn", "SMS delivery exhausted retries", {
      feature: "notifications", integration: "sms_ir", tenant_id: tenantId, error_code: "PROVIDER_UNAVAILABLE",
      phone: "09121234567", client_id: tenantId,
    }));
    assert.equal(localLogs.length, 1);
    assert.ok(localLogs[0]!.includes(tenantId));
    assert.ok(!localLogs[0]!.includes("09121234567"));
    await Sentry.flush(2000);
    assert.equal(sentLogs.length, 1);
    assert.ok(!JSON.stringify(sentLogs[0]).includes("09121234567"));
    assert.ok(JSON.stringify(sentLogs[0]).includes(tenantId));
    assert.ok(!JSON.stringify(sentLogs[0]).includes("client_id"));

    mode = "slow";
    sendStarted = new Promise<void>((resolve) => { onSendStarted = resolve; });
    assert.doesNotThrow(() => logOperationalFailure(logger, "warn", "SMS delivery exhausted retries", {
      feature: "notifications", integration: "sms_ir", tenant_id: tenantId, error_code: "PROVIDER_UNAVAILABLE",
    }));
    const drain = Sentry.flush(2000);
    await Promise.race([
      sendStarted,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Sentry log transport was not invoked")), 1500)),
    ]);
    assert.equal(localLogs.length, 2);
    releaseSlowSend?.({ statusCode: 200 });
    await drain;
  } finally {
    releaseSlowSend?.({ statusCode: 200 });
    await Sentry.close(2000);
  }
});

test("Nest Sentry boundary captures unexpected errors once, skips 4xx, and preserves responses", async () => {
  const captured: Event[] = [];
  const testOptions = getSentryOptions({ NODE_ENV: "test" });
  Sentry.init({
    ...testOptions,
    dsn: "https://public@example.test/1",
    transport: () => ({
      send: async (envelope) => {
        for (const [headers, payload] of envelope[1]) {
          if (headers.type === "event") captured.push(payload as Event);
        }
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
  });

  const app = await NestFactory.create(SentrySyntheticModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  try {
    const address = app.getHttpServer().address() as AddressInfo;
    const origin = `http://127.0.0.1:${address.port}`;
    const expected = await fetch(`${origin}/expected`);
    assert.equal(expected.status, 400);
    assert.deepEqual(await expected.json(), { message: "Bad Request", statusCode: 400 });
    await Sentry.flush(2000);
    assert.equal(captured.length, 0);

    const unexpected = await fetch(`${origin}/unexpected?phone=09120000000`, {
      headers: { authorization: "Bearer synthetic-access-token", cookie: "session=synthetic-secret" },
    });
    assert.equal(unexpected.status, 500);
    assert.deepEqual(await unexpected.json(), { statusCode: 500, message: "Internal server error" });
    await Sentry.flush(2000);
    assert.equal(captured.length, 1);
    assert.equal(captured[0]?.request, undefined);
    assert.ok(!JSON.stringify(captured[0]).includes("synthetic-access-token"));
    assert.ok(!JSON.stringify(captured[0]).includes("09120000000"));
    assert.ok(!JSON.stringify(captured[0]).includes("person@example.test"));

    const http500 = await fetch(`${origin}/http-500`);
    assert.equal(http500.status, 500);
    assert.deepEqual(await http500.json(), {
      message: "synthetic internal failure",
      error: "Internal Server Error",
      statusCode: 500,
    });
    await Sentry.flush(2000);
    assert.equal(captured.length, 2);
  } finally {
    await app.close();
    await Sentry.close(2000);
  }
});

test("failed and stalled Sentry transports do not change or delay API responses", async () => {
  type Mode = "failed" | "slow";
  let mode: Mode = "failed";
  let onSendStarted = () => {};
  let sendStarted = new Promise<void>((resolve) => { onSendStarted = resolve; });
  const releaseSlowSends: Array<(response: { statusCode: number }) => void> = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  Sentry.init({
    ...getSentryOptions({ NODE_ENV: "test" }),
    dsn: "https://public@example.test/1",
    tracesSampler: () => 1,
    transport: () => ({
      send: () => {
        onSendStarted();
        if (mode === "failed") return Promise.reject(new Error("synthetic Sentry network failure"));
        return new Promise((resolve) => { releaseSlowSends.push(resolve); });
      },
      flush: async () => true,
    }),
  });

  const app = await NestFactory.create(SentrySyntheticModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  const address = app.getHttpServer().address() as AddressInfo;
  const origin = `http://127.0.0.1:${address.port}`;
  const beforeTelemetry = <T>(promise: Promise<T>, message: string) => new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(message)), 2000);
    promise.then(
      (value) => { clearTimeout(timeout); resolve(value); },
      (error) => { clearTimeout(timeout); reject(error); },
    );
  });

  process.on("unhandledRejection", onUnhandled);
  try {
    const failedRequest = fetch(`${origin}/unexpected`);
    await beforeTelemetry(
      sendStarted,
      "Sentry failure transport was not invoked",
    );
    const failedResponse = await beforeTelemetry(failedRequest, "Failed-transport request waited on telemetry");
    assert.equal(failedResponse.status, 500);
    assert.deepEqual(await failedResponse.json(), { statusCode: 500, message: "Internal server error" });
    const successAfterFailure = await beforeTelemetry(fetch(`${origin}/success`), "Successful request waited on telemetry");
    assert.equal(successAfterFailure.status, 200);
    assert.deepEqual(await successAfterFailure.json(), { created: true });

    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);

    mode = "slow";
    sendStarted = new Promise<void>((resolve) => { onSendStarted = resolve; });
    const tracedRequest = fetch(`${origin}/traced-success`);
    await beforeTelemetry(sendStarted, "Slow Sentry trace transport was not invoked");
    const tracedResponse = await beforeTelemetry(tracedRequest, "Sampled trace delayed the API response");
    assert.equal(tracedResponse.status, 200);
    assert.deepEqual(await tracedResponse.json(), { created: true });

    sendStarted = new Promise<void>((resolve) => { onSendStarted = resolve; });
    const slowRequest = fetch(`${origin}/http-500`);
    await beforeTelemetry(
      sendStarted,
      "Slow Sentry transport was not invoked",
    );

    const slowResponse = await beforeTelemetry(slowRequest, "Slow-transport request waited on telemetry");
    assert.equal(slowResponse.status, 500);
    assert.deepEqual(await slowResponse.json(), {
      message: "synthetic internal failure",
      error: "Internal Server Error",
      statusCode: 500,
    });

    const success = await beforeTelemetry(fetch(`${origin}/success`), "Successful request waited on telemetry");
    assert.equal(success.status, 200);
    assert.deepEqual(await success.json(), { created: true });

    for (const release of releaseSlowSends) release({ statusCode: 200 });
    await Sentry.flush(2000);
  } finally {
    for (const release of releaseSlowSends) release({ statusCode: 200 });
    process.off("unhandledRejection", onUnhandled);
    await app.close();
    await Sentry.close(2000);
  }
});
