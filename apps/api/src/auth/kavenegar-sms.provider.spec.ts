import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { KavenegarSmsProvider } from "./kavenegar-sms.provider";

test("Kavenegar lookup maps confirmation tokens without placing the API key in the body", async () => {
  const original = global.fetch; let url = "", body = "";
  global.fetch = async (input, init) => { url = String(input); body = String(init?.body); return new Response(JSON.stringify({ return: { status: 200 }, entries: [{ messageid: 42 }] }), { status: 200 }); };
  try {
    const provider = new KavenegarSmsProvider(new ConfigService({ KAVENEGAR_API_KEY: "secret-key", KAVENEGAR_OTP_TEMPLATE: "otp", KAVENEGAR_RESERVATION_CONFIRMED_TEMPLATE: "confirmed" }));
    const result = await provider.sendReservationConfirmation({ phone: "09120000000", cafeName: "کافه", date: "1405/06/06", time: "18:30" });
    assert.equal(result.providerMessageId, "42"); assert.match(url, /secret-key\/verify\/lookup\.json/); assert.match(body, /template=confirmed/); assert.match(body, /token2=/); assert.doesNotMatch(body, /secret-key/);
  } finally { global.fetch = original; }
});
