import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { SimulatedGateway } from "./simulated.gateway";
import { ZarinpalGateway } from "./zarinpal.gateway";

test("simulated gateway returns a successful callback and stable verification reference", async () => {
  const gateway = new SimulatedGateway();
  const requested = await gateway.request({ amountRial: 2_500_000, callbackUrl: "http://localhost/callback?intentId=one", description: "test" });
  assert.match(requested.authority, /^SIM-/);
  assert.equal(requested.paymentUrl, gateway.paymentUrl(requested.authority, "http://localhost/callback?intentId=one"));
  assert.match((await gateway.verify({ authority: requested.authority, amountRial: 2_500_000 })).reference, /^SIMREF-/);
});

test("Zarinpal adapter sends the documented request and verification payloads", async (context) => {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const originalFetch = global.fetch;
  global.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(url), body });
    return new Response(JSON.stringify(calls.length === 1 ? { data: { code: 100, authority: "A000-test" } } : { data: { code: 101, ref_id: 98765 } }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  context.after(() => { global.fetch = originalFetch; });
  const gateway = new ZarinpalGateway(new ConfigService({ ZARINPAL_MERCHANT_ID: "00000000-0000-0000-0000-000000000000" }));
  const requested = await gateway.request({ amountRial: 2_500_000, callbackUrl: "https://cafexa.test/callback", description: "Silver" });
  assert.equal(requested.paymentUrl, "https://www.zarinpal.com/pg/StartPay/A000-test");
  assert.deepEqual(calls[0]?.body, { merchant_id: "00000000-0000-0000-0000-000000000000", amount: 2_500_000, callback_url: "https://cafexa.test/callback", description: "Silver" });
  assert.equal((await gateway.verify({ authority: "A000-test", amountRial: 2_500_000 })).reference, "98765");
  assert.deepEqual(calls[1]?.body, { merchant_id: "00000000-0000-0000-0000-000000000000", amount: 2_500_000, authority: "A000-test" });
});
