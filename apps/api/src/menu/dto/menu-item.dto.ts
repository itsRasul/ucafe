import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, ValidateNested } from "class-validator";

export class MenuItemVariantDto {
  @IsString() @MaxLength(80) name!: string;
  @IsInt() @Min(0) priceToman!: number;
  @IsOptional() @IsBoolean() isDefault = false;
  @IsOptional() @IsBoolean() isAvailable = true;
  @IsOptional() @IsInt() @Min(0) sortOrder = 0;
}

export class CreateMenuItemDto {
  @IsUUID() categoryId!: string;
  @IsString() @MaxLength(140) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) basePriceToman?: number | null;
  @IsOptional() @IsBoolean() isAvailable = true;
  @IsOptional() @IsBoolean() isFeatured = false;
  @IsOptional() @IsInt() @Min(0) sortOrder = 0;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MenuItemVariantDto) variants: MenuItemVariantDto[] = [];
}

export class UpdateMenuItemDto {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsString() @MaxLength(140) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsInt() @Min(0) basePriceToman?: number | null;
  @IsOptional() @IsBoolean() isAvailable?: boolean;
  @IsOptional() @IsBoolean() isFeatured?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => MenuItemVariantDto) variants?: MenuItemVariantDto[];
}
