import { Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { maskPhone } from "./iran-phone.util";
import { SendOtpMessage, SendTemplateMessage, SmsDeliveryResult, SmsProvider } from "./sms-provider";

export class DevelopmentSmsProvider implements SmsProvider {
  private readonly logger = new Logger("DevelopmentSmsProvider");

  constructor(config: ConfigService) {
    if (config.get<string>("NODE_ENV") === "production") {
      throw new Error("Development SMS provider must not run in production");
    }
  }

  async sendOtp(message: SendOtpMessage): Promise<SmsDeliveryResult> {
    this.logger.warn(`[DEV OTP] ${maskPhone(message.phone)} code=${message.otp} expires=${message.expiresInSeconds}s`);
    return { providerMessageId: `dev-${randomUUID()}` };
  }

  async sendTemplate(message: SendTemplateMessage): Promise<SmsDeliveryResult> {
    this.logger.log(`[DEV SMS] ${maskPhone(message.phone)} template=${message.templateId}`);
    return { providerMessageId: `dev-${randomUUID()}` };
  }
}
