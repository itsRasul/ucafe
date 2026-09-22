import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { PlanStatus } from "../entities";

export class UpdatePlanFeaturesDto {
  @IsOptional() @IsBoolean() menu?: boolean;
  @IsOptional() @IsBoolean() reservations?: boolean;
  @IsOptional() @IsBoolean() onlineOrdering?: boolean;
}

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) priceToman?: number;
  @IsOptional() @IsInt() @Min(0) @Max(32_000) sortOrder?: number;
  @IsOptional() @IsInt() @Min(1) @Max(12) billingMonths?: number;
  @IsOptional() @IsEnum(PlanStatus) status?: PlanStatus;
  @IsOptional() @IsInt() @Min(0) @Max(90) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) graceDays?: number;
  @IsOptional() @ValidateNested() @Type(() => UpdatePlanFeaturesDto) features?: UpdatePlanFeaturesDto;
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(["menu", "reservations", "onlineOrdering"], { each: true }) highlightedFeatureKeys?: string[];
}
