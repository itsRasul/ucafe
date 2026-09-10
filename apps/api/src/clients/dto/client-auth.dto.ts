import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export class RequestClientOtpDto {
  @IsString() @MinLength(10) @MaxLength(32) phone!: string;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}

export class VerifyClientOtpDto {
  @IsUUID() challengeId!: string;
  @Matches(/^\d{6}$/) otp!: string;
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
}
