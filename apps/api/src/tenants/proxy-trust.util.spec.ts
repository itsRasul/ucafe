import assert from "node:assert/strict";
import test from "node:test";
import { trustedForwardedTenantHost } from "./proxy-trust.util";

test("accepts the forwarded tenant hostname only with the configured proxy secret", () => {
  const secret = "a-secure-internal-proxy-secret-value";
  assert.equal(trustedForwardedTenantHost("cafe.u-cafe.test", secret, secret), "cafe.u-cafe.test");
  assert.equal(trustedForwardedTenantHost("victim.u-cafe.test", "wrong", secret), undefined);
  assert.equal(trustedForwardedTenantHost("victim.u-cafe.test", undefined, secret), undefined);
});
