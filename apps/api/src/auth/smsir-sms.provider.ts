import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SendOtpMessage, SmsDeliveryResult, SmsProvider } from "./sms-provider";

type SmsIrVerifyResponse = { status?: number; message?: string; data?: { messageId?: number } };

const verifyUrl = "https://api.sms.ir/v1/send/verify";
const maxParameterLength = 25;

export class SmsIrSmsProvider implements SmsProvider {
  private readonly key: string; private readonly otpTemplateId: number; private readonly confirmationTemplateId: number;
  constructor(config: ConfigService) { this.key = config.getOrThrow("SMSIR_API_KEY"); this.otpTemplateId = Number(config.getOrThrow("SMSIR_OTP_TEMPLATE_ID")); this.confirmationTemplateId = Number(config.getOrThrow("SMSIR_RESERVATION_CONFIRMED_TEMPLATE_ID")); }
  sendOtp(message: SendOtpMessage) { return this.verify(message.phone, this.otpTemplateId, [{ name: "TOKEN", value: message.otp }]); }
  sendReservationConfirmation(message: { phone: string; cafeName: string; date: string; time: string }) { return this.verify(message.phone, this.confirmationTemplateId, [{ name: "CAFE", value: message.cafeName }, { name: "DATE", value: message.date }, { name: "TIME", value: message.time }]); }
  private async verify(phone: string, templateId: number, parameters: Array<{ name: string; value: string }>): Promise<SmsDeliveryResult> {
    const body = JSON.stringify({ mobile: phone, templateId, parameters: parameters.map((parameter) => ({ name: parameter.name, value: parameter.value.slice(0, maxParameterLength) })) });
    const response = await fetch(verifyUrl, { method: "POST", headers: { "content-type": "application/json", accept: "text/plain", "x-api-key": this.key }, body, signal: AbortSignal.timeout(10_000) });
    const result = await response.json().catch(() => ({})) as SmsIrVerifyResponse;
    const messageId = result.data?.messageId;
    if (!response.ok || result.status !== 1 || !messageId) throw new ServiceUnavailableException("SMS provider rejected the message");
    return { providerMessageId: String(messageId) };
  }
}

