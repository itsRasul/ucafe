import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, Min } from "class-validator";

export class CreateMenuCategoryDto {
  @IsString() @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder = 0;
  @IsOptional() @IsBoolean() isActive = true;
}

export class UpdateMenuCategoryDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(240) description?: string | null;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
