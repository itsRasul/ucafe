import { IsIn, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export class CreateCheckoutDto {
  @IsString()
  @Matches(/^silver$/)
  planKey!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9_-]+$/)
  idempotencyKey!: string;
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
