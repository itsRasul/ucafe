import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from "class-validator";

export class RecipeCostQueryDto {
  @IsOptional() @IsUUID() versionId?: string;
}

export class MenuProfitabilityQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsIn(["NOT_CONFIGURED", "NO_ACTIVE_VERSION", "COMPLETE", "INCOMPLETE", "NO_COST_DATA"]) costingStatus?: string;
  @IsOptional() @IsIn(["sellingPrice", "recipeCost", "grossProfit", "grossMargin", "materialCost"]) sortBy?: string;
  @IsOptional() @IsIn(["ASC", "DESC"]) sortDirection?: "ASC" | "DESC";
  @IsOptional() @Transform(({ value }) => value === true || value === "true") @IsBoolean() includeUnavailable?: boolean;
}
