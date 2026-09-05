import assert from "node:assert/strict";
import test from "node:test";
import { maskPhone, normalizeIranianMobile } from "./iran-phone.util";

test("normalizes common Iranian mobile formats and Persian digits", () => {
  assert.equal(normalizeIranianMobile("0912 123 4567"), "+989121234567");
  assert.equal(normalizeIranianMobile("989121234567"), "+989121234567");
  assert.equal(normalizeIranianMobile("۰۰۹۸۹۱۲۱۲۳۴۵۶۷"), "+989121234567");
});

test("rejects non-mobile and malformed phone numbers", () => {
  assert.throws(() => normalizeIranianMobile("02112345678"), /invalid/);
  assert.throws(() => normalizeIranianMobile("+98912"), /invalid/);
});

test("masks phone numbers for development logs", () => {
  assert.equal(maskPhone("+989121234567"), "+989*****67");
});
