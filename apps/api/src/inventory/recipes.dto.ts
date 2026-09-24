import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from "class-validator";

const quantity = /^\d{1,14}(?:\.\d{1,6})?$/;

export class RecipeTargetDto {
  @IsUUID() menuItemId!: string;
  @IsOptional() @IsUUID() menuItemVariantId?: string | null;
}

export class RecipeComponentDto {
  @IsUUID() inventoryItemId!: string;
  @Matches(quantity) quantity!: string;
  @IsString() @MaxLength(16) unit!: string;
  @IsOptional() @IsString() @MaxLength(240) note?: string | null;
}

export class ReplaceRecipeComponentsDto {
  @IsInt() @Min(0) expectedRevision!: number;
  @IsArray() @ArrayMaxSize(100) @ArrayUnique((component: RecipeComponentDto) => component.inventoryItemId) @ValidateNested({ each: true }) @Type(() => RecipeComponentDto) components!: RecipeComponentDto[];
}
