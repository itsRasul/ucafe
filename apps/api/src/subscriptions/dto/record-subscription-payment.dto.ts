import { IsOptional, IsString, MaxLength } from "class-validator";

export class RecordSubscriptionPaymentDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  planKey = "silver";

  @IsOptional()
  @IsString()
  @MaxLength(40)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  providerReference?: string;
}
