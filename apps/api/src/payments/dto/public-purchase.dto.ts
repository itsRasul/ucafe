import { IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

export class PurchaseSlugDto {
  @IsString()
  @MaxLength(63)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  slug!: string;
}

export class PreparePurchaseDto extends PurchaseSlugDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @IsString()
  @MaxLength(40)
  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  planKey!: string;
}

export class PurchaseInvoiceDto extends PurchaseSlugDto {
  @IsUUID()
  intentId!: string;
}
