import assert from "node:assert/strict";
import test from "node:test";
import { validateMenuPricing } from "./menu-validation.util";

test("requires either a base price or a size variant", () => assert.match(validateMenuPricing(null, [])!, /requires/));
test("allows one default size variant", () => assert.equal(validateMenuPricing(null, [{ name: "کوچک", isDefault: true }, { name: "بزرگ", isDefault: false }]), null));
test("rejects duplicate variant names and multiple defaults", () => {
  assert.match(validateMenuPricing(null, [{ name: "کوچک", isDefault: true }, { name: "بزرگ", isDefault: true }])!, /Only one/);
  assert.match(validateMenuPricing(null, [{ name: "کوچک", isDefault: false }, { name: " کوچک ", isDefault: false }])!, /unique/);
});
