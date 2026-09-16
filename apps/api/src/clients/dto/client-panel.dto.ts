import { IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export class UpdateClientProfileDto {
  @IsString() @MinLength(1) @MaxLength(80) @Matches(/\S/) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) @Matches(/\S/) lastName!: string;
}

export class RequestClientPhoneChangeDto {
  @IsString() @MinLength(10) @MaxLength(32) phone!: string;
}

export class VerifyClientPhoneChangeDto {
  @IsUUID() challengeId!: string;
  @Matches(/^\d{6}$/) otp!: string;
}
