import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { AuthCryptoService } from "./auth-crypto.service";

const config = new ConfigService({
  AUTH_PEPPER: "test-only-auth-pepper-with-at-least-32-characters",
  PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
});
const crypto = new AuthCryptoService(config);

test("generates six-digit OTP values", () => {
  assert.match(crypto.generateOtp(), /^\d{6}$/);
});

test("verifies OTP hashes without storing the OTP", () => {
  const hash = crypto.hashOtp("challenge-a", "123456");
  assert.equal(hash.length, 64);
  assert.equal(crypto.verifyOtp("challenge-a", "123456", hash), true);
  assert.equal(crypto.verifyOtp("challenge-a", "654321", hash), false);
  assert.equal(crypto.verifyOtp("challenge-b", "123456", hash), false);
});

test("encrypts phone values with randomized authenticated encryption", () => {
  const first = crypto.encryptPhone("+989121234567");
  const second = crypto.encryptPhone("+989121234567");
  assert.notEqual(first, second);
  assert.equal(crypto.decryptPhone(first), "+989121234567");
  const parts = first.split(".");
  const tamperedBytes = Buffer.from(parts[3]!, "base64url");
  tamperedBytes[0] = tamperedBytes[0]! ^ 1;
  parts[3] = tamperedBytes.toString("base64url");
  assert.throws(() => crypto.decryptPhone(parts.join(".")));
});

test("creates unique opaque refresh tokens and stable hashes", () => {
  const first = crypto.generateRefreshToken();
  const second = crypto.generateRefreshToken();
  assert.notEqual(first, second);
  assert.equal(crypto.hashRefreshToken(first), crypto.hashRefreshToken(first));
  assert.notEqual(crypto.hashRefreshToken(first), crypto.hashRefreshToken(second));
});
