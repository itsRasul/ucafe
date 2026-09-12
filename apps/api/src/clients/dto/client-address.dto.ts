import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

export class CreateClientAddressDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsString() @MinLength(2) @MaxLength(80) province!: string;
  @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @IsString() @MinLength(5) @MaxLength(700) addressLine!: string;
  @IsString() @MinLength(1) @MaxLength(20) buildingNumber!: string;
  @IsOptional() @IsString() @MaxLength(20) unit?: string;
  @IsOptional() @Matches(/^\d{10}$/) postalCode?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}

export class UpdateClientAddressDto extends CreateClientAddressDto {}
