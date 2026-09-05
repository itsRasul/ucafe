import assert from "node:assert/strict";
import test from "node:test";
import { buildTenantHostname, normalizeHostname } from "./hostname.util";

test("normalizes case, trailing dots, and ports", () => {
  assert.equal(normalizeHostname(" Demo.Cafexa.Localhost.:3001 "), "demo.cafexa.localhost");
});

test("builds a tenant hostname from a trusted base domain", () => {
  assert.equal(buildTenantHostname("demo-cafe", "cafexa.localhost"), "demo-cafe.cafexa.localhost");
});

test("rejects malformed hostnames", () => {
  assert.throws(() => normalizeHostname("not a host"), /invalid/);
  assert.throws(() => normalizeHostname("-demo.cafexa.localhost"), /invalid/);
});
