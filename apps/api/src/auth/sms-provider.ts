export interface SendOtpMessage {
  phone: string;
  otp: string;
  expiresInSeconds: number;
}

export interface SmsDeliveryResult {
  providerMessageId: string;
}

export interface SmsProvider {
  sendOtp(message: SendOtpMessage): Promise<SmsDeliveryResult>;
  sendReservationConfirmation(message: { phone: string; cafeName: string; date: string; time: string }): Promise<SmsDeliveryResult>;
}

export const SMS_PROVIDER = Symbol("SMS_PROVIDER");
