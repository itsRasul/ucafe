import assert from "node:assert/strict";
import test from "node:test";
import { displayOrderNumber, displayToman, jalaliDate } from "./notification-type";

test("SMS display values are short and Persian-friendly", () => {
  assert.equal(displayOrderNumber("12345678-abcd-4000-8000-000000000000"), "12345678");
  assert.equal(displayToman("1900000"), "۱٬۹۰۰٬۰۰۰");
  assert.match(jalaliDate("2026-09-17"), /^۱۴۰۵\/۰۶\/۲۶$/);
});
