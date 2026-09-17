export interface SendOtpMessage {
  phone: string;
  otp: string;
  expiresInSeconds: number;
}

export interface SmsDeliveryResult {
  providerMessageId: string;
}

export interface SendTemplateMessage {
  phone: string;
  templateId: number;
  parameters: Array<{ name: string; value: string }>;
}

export interface SmsProvider {
  sendOtp(message: SendOtpMessage): Promise<SmsDeliveryResult>;
  sendTemplate(message: SendTemplateMessage): Promise<SmsDeliveryResult>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
