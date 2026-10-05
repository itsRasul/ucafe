import { NotificationType } from "../notifications/notification-type";
import assert from "node:assert/strict";
import test from "node:test";
import { environmentSchema } from "./environment.schema";

const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/ucafe", REDIS_URL: "redis://localhost:6379", PLATFORM_BASE_DOMAIN: "u-cafe.test", ACCESS_TOKEN_SECRET: "a".repeat(32), AUTH_PEPPER: "b".repeat(32), PII_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), INTERNAL_PROXY_SECRET: "c".repeat(32), S3_ENDPOINT: "https://objects.example.test", S3_REGION: "us-east-1", S3_BUCKET: "ucafe-media", S3_ACCESS_KEY: "access", S3_SECRET_KEY: "secret-value", PAYMENT_CALLBACK_BASE_URL: "https://api.u-cafe.test" };
const templates = Object.fromEntries(Object.values(NotificationType).map((key, index) => [key, String(100001 + index)]));

test("production fails closed when SMS or payment simulators are selected", () => {
  assert.ok(environmentSchema.validate({ ...base, NODE_ENV: "production", SMS_PROVIDER: "development", PAYMENT_PROVIDER: "simulated" }).error);
});

test("production provider configuration accepts only the real adapters and HTTPS callback", () => {
  const result = environmentSchema.validate({ ...base, ...templates, PLATFORM_PUBLIC_URL: "https://u-cafe.test", NODE_ENV: "production", SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000", PAYMENT_PROVIDER: "zarinpal", ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000" });
  assert.equal(result.error, undefined);
});

test("sms.ir templates must be the numeric panel ids", () => {
  assert.ok(environmentSchema.validate({ ...base, ...templates, SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "otp" }).error);
  const missingTrialTemplate = { ...templates } as Record<string, string>;
  delete missingTrialTemplate.TRIAL_EXPIRED;
  assert.ok(environmentSchema.validate({ ...base, ...missingTrialTemplate, SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000" }).error);
  const missingTicketTemplate = { ...templates } as Record<string, string>;
  delete missingTicketTemplate.SUPPORT_TICKET_TENANT_REPLIED;
  assert.ok(environmentSchema.validate({ ...base, ...missingTicketTemplate, SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000" }).error);
});

test("invalid optional Sentry config cannot prevent API startup", () => {
  const result = environmentSchema.validate({ ...base, SENTRY_DSN: "https://public@example.test/1", SENTRY_ENVIRONMENT: "production", SENTRY_RELEASE: "abc123" });
  assert.equal(result.error, undefined);
  assert.equal(environmentSchema.validate({ ...base, SENTRY_DSN: "not-a-sentry-dsn", SENTRY_ENVIRONMENT: "staging", SENTRY_RELEASE: "x".repeat(500) }).error, undefined);
});

test("public return origin rejects credentials, paths and unrelated production hosts", () => {
  for (const PLATFORM_PUBLIC_URL of ["http://localhost:3000/start", "http://user@localhost:3000", "http://localhost:3000?redirect=other"]) assert.ok(environmentSchema.validate({ ...base, PLATFORM_PUBLIC_URL }).error);
  assert.equal(environmentSchema.validate({ ...base, PLATFORM_PUBLIC_URL: "http://localhost:3000" }).error, undefined);
  assert.ok(environmentSchema.validate({ ...base, ...templates, PLATFORM_PUBLIC_URL: "https://other.test", NODE_ENV: "production", SMS_PROVIDER: "smsir", SMSIR_API_KEY: "test-api-key", SMSIR_OTP_TEMPLATE_ID: "100000", PAYMENT_PROVIDER: "zarinpal", ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000" }).error);
});
