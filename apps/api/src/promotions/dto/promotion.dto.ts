import { Type } from "class-transformer";
import { ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { PromotionRewardType } from "../entities";

export class PromotionTargetDto {
  @IsOptional() @IsUUID() menuItemId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class CreatePromotionDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() isActive = false;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) priority = 0;
  @IsEnum(PromotionRewardType) rewardType!: PromotionRewardType;
  @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) rewardValue!: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PromotionTargetDto) targets!: PromotionTargetDto[];
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) priority?: number;
  @IsOptional() @IsEnum(PromotionRewardType) rewardType?: PromotionRewardType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) rewardValue?: number;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PromotionTargetDto) targets?: PromotionTargetDto[];
}
