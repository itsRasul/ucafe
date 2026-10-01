import assert from "node:assert/strict";
import test from "node:test";
import { environmentSchema } from "./environment.schema";

const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/ucafe", REDIS_URL: "redis://localhost:6379", PLATFORM_BASE_DOMAIN: "u-cafe.test", ACCESS_TOKEN_SECRET: "a".repeat(32), AUTH_PEPPER: "b".repeat(32), PII_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), INTERNAL_PROXY_SECRET: "c".repeat(32), S3_ENDPOINT: "https://objects.example.test", S3_REGION: "us-east-1", S3_BUCKET: "ucafe-media", S3_ACCESS_KEY: "access", S3_SECRET_KEY: "secret-value", PAYMENT_CALLBACK_BASE_URL: "https://api.u-cafe.test" };
const templates = Object.fromEntries(["ORDER_PLACED","ORDER_CONFIRMED","ORDER_READY_ON_SITE","ORDER_READY_DELIVERY","ORDER_COMPLETED","ORDER_CANCELLED","ORDER_PLACED_FOR_ADMIN_TENANT","RESERVATION_PLACED","RESERVATION_PLACED_BY_ADMIN","RESERVATION_CONFIRMED","RESERVATION_EDITED_BY_ADMIN","RESERVATION_CANCELLED","RESERVATION_PLACED_TO_ADMIN","RESERVATION_REMINDER","RENEWING_SUBSCRIPTION_REMINDER_3","RENEWING_REMINDER_SUBSCRIPTION_2","RENEWING_SUBSCRIPTION_REMINDER_1","RENEWING_SUBSCRIPTION_LAST_DAY","SUBSCRIPTION_EXPIRED","SUBSCRIPTION_REMINDER_FOLLOW_UP","SUBSCRIPTION_SUCCESSFULLY_PAID","SUBSCRIPTION_FAILD_PAID","REQUEST_COUNSELING","SUPPORT_TICKET_CREATED","SUPPORT_TICKET_PLATFORM_REPLIED","SUPPORT_TICKET_TENANT_REPLIED"].map((key, index) => [key, String(100001 + index)]));

test("production fails closed when SMS or payment simulators are selected", () => {
  assert.ok(environmentSchema.validate({ ...base, NODE_ENV: "production", SMS_PROVIDER: "development", PAYMENT_PROVIDER: "simulated" }).error);
});

test("production provider configuration accepts only the real adapters and HTTPS callback", () => {
  const result = environmentSchema.validate({ ...base, ...templates, NODE_ENV: "production", SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000", PAYMENT_PROVIDER: "zarinpal", ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000" });
  assert.equal(result.error, undefined);
});

test("sms.ir templates must be the numeric panel ids", () => {
  assert.ok(environmentSchema.validate({ ...base, ...templates, SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "otp" }).error);
  const missingTicketTemplate = { ...templates } as Record<string, string>;
  delete missingTicketTemplate.SUPPORT_TICKET_TENANT_REPLIED;
  assert.ok(environmentSchema.validate({ ...base, ...missingTicketTemplate, SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000" }).error);
});

test("invalid optional Sentry config cannot prevent API startup", () => {
  const result = environmentSchema.validate({ ...base, SENTRY_DSN: "https://public@example.test/1", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "abc123" });
  assert.equal(result.error, undefined);
  assert.equal(environmentSchema.validate({ ...base, SENTRY_DSN: "not-a-sentry-dsn", SENTRY_ENVIRONMENT: "staging", SENTRY_RELEASE: "x".repeat(500) }).error, undefined);
});
