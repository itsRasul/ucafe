import { IsUUID, Matches } from "class-validator";

export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  @Matches(/^\d{6}$/)
  otp!: string;
}
