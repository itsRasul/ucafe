import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CrmScoringCategory } from "../crm-scoring.util";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const categories = Object.values(CrmScoringCategory);

export class CreateCrmScoringRuleDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(categories) category!: CrmScoringCategory;
  @IsObject() criteria!: Record<string, unknown>;
  @Type(() => Number) @IsInt() @Min(-100) @Max(100) points!: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class UpdateCrmScoringRuleDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(categories) category?: CrmScoringCategory;
  @IsOptional() @IsObject() criteria?: Record<string, unknown>;
  @IsOptional() @Type(() => Number) @IsInt() @Min(-100) @Max(100) points?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
}

export class PreviewCrmScoringRuleDto {
  @IsIn(categories) category!: CrmScoringCategory;
  @IsObject() criteria!: Record<string, unknown>;
}
