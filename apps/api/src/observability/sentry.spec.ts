import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { BadRequestException, Controller, Get, InternalServerErrorException, Module } from "@nestjs/common";
import { APP_FILTER, NestFactory } from "@nestjs/core";
import * as Sentry from "@sentry/nestjs";
import { SentryModule } from "@sentry/nestjs/setup";
import type { ErrorEvent, Event } from "@sentry/nestjs";
import { getSentryOptions } from "./sentry-options";
import { sanitizeSentryEvent } from "./sentry-privacy";
import { UcafeSentryGlobalFilter } from "./sentry-global.filter";

test("Sentry config stays disabled in tests and keeps environment/release configurable", () => {
  assert.equal(getSentryOptions({ NODE_ENV: "test", SENTRY_DSN: "https://public@example.test/1" }).dsn, undefined);
  assert.equal(getSentryOptions({ NODE_ENV: "development" }).dsn, undefined);
  const options = getSentryOptions({ NODE_ENV: "production", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "abc123" });
  assert.equal(options.environment, "production");
  assert.equal(options.release, "abc123");
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

@Controller()
class SentrySyntheticController {
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
