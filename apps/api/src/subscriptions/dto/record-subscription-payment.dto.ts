import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

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

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey!: string;
}
