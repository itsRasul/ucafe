import { ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { SendOtpMessage, SmsDeliveryResult, SmsProvider } from "./sms-provider";

type KavenegarResponse = { return?: { status?: number; message?: string }; entries?: Array<{ messageid?: number }> };
export class KavenegarSmsProvider implements SmsProvider {
  private readonly key: string; private readonly otpTemplate: string; private readonly confirmationTemplate: string;
  constructor(config: ConfigService) { this.key = config.getOrThrow("KAVENEGAR_API_KEY"); this.otpTemplate = config.getOrThrow("KAVENEGAR_OTP_TEMPLATE"); this.confirmationTemplate = config.getOrThrow("KAVENEGAR_RESERVATION_CONFIRMED_TEMPLATE"); }
  sendOtp(message: SendOtpMessage) { return this.lookup(message.phone, this.otpTemplate, [message.otp]); }
  sendReservationConfirmation(message: { phone: string; cafeName: string; date: string; time: string }) { return this.lookup(message.phone, this.confirmationTemplate, [message.cafeName, message.date, message.time]); }
  private async lookup(phone: string, template: string, tokens: string[]): Promise<SmsDeliveryResult> {
    const body = new URLSearchParams({ receptor: phone, template, token: tokens[0]!, ...(tokens[1] ? { token2: tokens[1] } : {}), ...(tokens[2] ? { token3: tokens[2] } : {}) });
    const response = await fetch(`https://api.kavenegar.com/v1/${encodeURIComponent(this.key)}/verify/lookup.json`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body, signal: AbortSignal.timeout(10_000) });
    const result = await response.json().catch(() => ({})) as KavenegarResponse;
    const messageId = result.entries?.[0]?.messageid;
    if (!response.ok || result.return?.status !== 200 || !messageId) throw new ServiceUnavailableException("SMS provider rejected the message");
    return { providerMessageId: String(messageId) };
  }
}
