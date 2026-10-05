import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

export class CreatePlanDisplayFeatureDto {
  @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @IsOptional() @IsInt() @Min(0) @Max(32_000) sortOrder?: number;
}

export class UpdatePlanDisplayFeatureDefinitionDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) label?: string;
  @IsOptional() @IsInt() @Min(0) @Max(32_000) sortOrder?: number;
}

export class SetPlanDisplayFeatureValueDto {
  @IsString() @MinLength(1) @MaxLength(160) value!: string;
}
