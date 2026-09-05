import { IsString, MaxLength, MinLength } from "class-validator";

export class RequestOtpDto {
  @IsString()
  @MinLength(10)
  @MaxLength(32)
  phone!: string;
}
