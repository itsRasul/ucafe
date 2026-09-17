import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SendOtpMessage, SendTemplateMessage, SmsDeliveryResult, SmsProvider } from "./sms-provider";

type SmsIrVerifyResponse = { status?: number; message?: string; data?: { messageId?: number } };

const verifyUrl = "https://api.sms.ir/v1/send/verify";
const maxParameterLength = 25;

export class SmsIrSmsProvider implements SmsProvider {
  private readonly key: string; private readonly otpTemplateId: number;
  constructor(config: ConfigService) { this.key = config.getOrThrow("SMSIR_API_KEY"); this.otpTemplateId = Number(config.getOrThrow("SMSIR_OTP_TEMPLATE_ID")); }
  sendOtp(message: SendOtpMessage) { return this.verify(message.phone, this.otpTemplateId, [{ name: "TOKEN", value: message.otp }]); }
  sendTemplate(message: SendTemplateMessage) { return this.verify(message.phone, message.templateId, message.parameters); }
  private async verify(phone: string, templateId: number, parameters: Array<{ name: string; value: string }>): Promise<SmsDeliveryResult> {
    const body = JSON.stringify({ mobile: phone, templateId, parameters: parameters.map((parameter) => ({ name: parameter.name, value: parameter.value.slice(0, maxParameterLength) })) });
    const response = await fetch(verifyUrl, { method: "POST", headers: { "content-type": "application/json", accept: "text/plain", "x-api-key": this.key }, body, signal: AbortSignal.timeout(10_000) });
    const result = await response.json().catch(() => ({})) as SmsIrVerifyResponse;
    const messageId = result.data?.messageId;
    if (!response.ok || result.status !== 1 || !messageId) throw new ServiceUnavailableException("SMS provider rejected the message");
    return { providerMessageId: String(messageId) };
  }
}
