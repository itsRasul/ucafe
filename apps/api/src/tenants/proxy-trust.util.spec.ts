import assert from "node:assert/strict";
import test from "node:test";
import { trustedForwardedTenantHost } from "./proxy-trust.util";

test("accepts the forwarded tenant hostname only with the configured proxy secret", () => {
  const secret = "a-secure-internal-proxy-secret-value";
  assert.equal(trustedForwardedTenantHost("cafe.cafexa.test", secret, secret), "cafe.cafexa.test");
  assert.equal(trustedForwardedTenantHost("victim.cafexa.test", "wrong", secret), undefined);
  assert.equal(trustedForwardedTenantHost("victim.cafexa.test", undefined, secret), undefined);
});
