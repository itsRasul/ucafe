import { IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class ProvisionTenantDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  @MaxLength(63)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  ownerPhone?: string;
}
