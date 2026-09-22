import { IsDateString, IsIn, IsInt, IsString, IsUUID, Matches, MaxLength, Min, MinLength } from "class-validator";

export class CreateCheckoutDto {
  @IsString()
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  planKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey!: string;

  @IsInt()
  @Min(0)
  expectedSubscriptionVersion!: number;

  @IsDateString()
  expectedPlanUpdatedAt!: string;
}

export class PaymentCallbackDto {
  @IsUUID()
  intentId!: string;

  @IsString()
  @MaxLength(160)
  @Matches(/^[A-Za-z0-9_-]+$/)
  Authority!: string;

  @IsIn(["OK", "NOK"])
  Status!: "OK" | "NOK";
}
