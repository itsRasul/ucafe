import assert from "node:assert/strict";
import test from "node:test";
import { environmentSchema } from "./environment.schema";

const base = { DATABASE_URL: "postgresql://user:pass@localhost:5432/ucafe", REDIS_URL: "redis://localhost:6379", PLATFORM_BASE_DOMAIN: "u-cafe.test", ACCESS_TOKEN_SECRET: "a".repeat(32), AUTH_PEPPER: "b".repeat(32), PII_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), INTERNAL_PROXY_SECRET: "c".repeat(32), S3_ENDPOINT: "https://objects.example.test", S3_REGION: "us-east-1", S3_BUCKET: "ucafe-media", S3_ACCESS_KEY: "access", S3_SECRET_KEY: "secret-value", PAYMENT_CALLBACK_BASE_URL: "https://api.u-cafe.test" };

test("production fails closed when SMS or payment simulators are selected", () => {
  assert.ok(environmentSchema.validate({ ...base, NODE_ENV: "production", SMS_PROVIDER: "development", PAYMENT_PROVIDER: "simulated" }).error);
});

test("production provider configuration accepts only the real adapters and HTTPS callback", () => {
  const result = environmentSchema.validate({ ...base, NODE_ENV: "production", SMS_PROVIDER: "kavenegar", KAVENEGAR_API_KEY: "test-api-key", KAVENEGAR_OTP_TEMPLATE: "otp", KAVENEGAR_RESERVATION_CONFIRMED_TEMPLATE: "reservation", PAYMENT_PROVIDER: "zarinpal", ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000" });
  assert.equal(result.error, undefined);
});
