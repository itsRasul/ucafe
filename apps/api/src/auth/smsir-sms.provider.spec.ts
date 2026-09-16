import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { SmsIrSmsProvider } from "./smsir-sms.provider";

function provider() { return new SmsIrSmsProvider(new ConfigService({ SMSIR_API_KEY: "secret-key", SMSIR_OTP_TEMPLATE_ID: "100000", SMSIR_RESERVATION_CONFIRMED_TEMPLATE_ID: "100001" })); }

test("sms.ir verify posts the OTP template parameter and keeps the API key out of the body", async () => {
  const original = global.fetch; let url = "", init: RequestInit | undefined;
  global.fetch = async (input, options) => { url = String(input); init = options; return new Response(JSON.stringify({ status: 1, message: "موفق", data: { messageId: 89545112 } }), { status: 200 }); };
  try {
    const result = await provider().sendOtp({ phone: "09120000000", otp: "123456", expiresInSeconds: 120 });
    const body = JSON.parse(String(init?.body)) as { mobile: string; templateId: number; parameters: Array<{ name: string; value: string }> };
    assert.equal(result.providerMessageId, "89545112");
    assert.equal(url, "https://api.sms.ir/v1/send/verify");
    assert.equal((init?.headers as Record<string, string>)["x-api-key"], "secret-key");
    assert.equal(body.templateId, 100000); assert.equal(body.mobile, "09120000000");
    assert.deepEqual(body.parameters, [{ name: "TOKEN", value: "123456" }]);
    assert.doesNotMatch(String(init?.body), /secret-key/);
  } finally { global.fetch = original; }
});

test("sms.ir verify maps confirmation parameters and clamps them to 25 characters", async () => {
  const original = global.fetch; let init: RequestInit | undefined;
  global.fetch = async (input, options) => { init = options; return new Response(JSON.stringify({ status: 1, message: "موفق", data: { messageId: 42 } }), { status: 200 }); };
  try {
    const result = await provider().sendReservationConfirmation({ phone: "09120000000", cafeName: "ک".repeat(40), date: "1405/06/06", time: "18:30" });
    const body = JSON.parse(String(init?.body)) as { templateId: number; parameters: Array<{ name: string; value: string }> };
    assert.equal(result.providerMessageId, "42"); assert.equal(body.templateId, 100001);
    assert.deepEqual(body.parameters.map((parameter) => parameter.name), ["CAFE", "DATE", "TIME"]);
    assert.equal(body.parameters[0]!.value.length, 25);
  } finally { global.fetch = original; }
});

test("sms.ir verify rejects a provider error status", async () => {
  const original = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ status: 112, message: "قالب یافت نشد" }), { status: 200 });
  try {
    await assert.rejects(() => provider().sendOtp({ phone: "09120000000", otp: "123456", expiresInSeconds: 120 }));
  } finally { global.fetch = original; }
});
