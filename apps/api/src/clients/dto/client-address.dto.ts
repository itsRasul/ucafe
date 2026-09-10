import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

export class CreateClientAddressDto {
  @IsOptional() @IsString() @MaxLength(80) label?: string;
  @IsString() @MinLength(5) @MaxLength(700) addressLine!: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
