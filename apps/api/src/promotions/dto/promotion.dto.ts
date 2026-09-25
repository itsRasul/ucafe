import { Type } from "class-transformer";
import { ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { AdvancedPromotionType, PromotionRewardType } from "../entities";
import { PROMOTION_WEEKDAYS, PromotionWeekday } from "../promotion-schedule.util";

export class PromotionTargetDto {
  @IsOptional() @IsUUID() menuItemId?: string;
  @IsOptional() @IsUUID() categoryId?: string;
}

export class PromotionScheduleWindowDto {
  @IsArray() @ArrayMinSize(1) @ArrayUnique() @IsEnum(PROMOTION_WEEKDAYS, { each: true }) daysOfWeek!: PromotionWeekday[];
  @IsOptional() @IsBoolean() isAllDay?: boolean;
  @IsOptional() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) startTime?: string | null;
  @IsOptional() @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d$/) endTime?: string | null;
}

export class PromotionScheduleDto {
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PromotionScheduleWindowDto)
  windows!: PromotionScheduleWindowDto[];
}

export class PromotionRuleGroupDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(50) quantity!: number;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PromotionTargetDto)
  targets!: PromotionTargetDto[];
}

export class PromotionQuantityTierDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(50) minimumQuantity!: number;
  @IsIn([PromotionRewardType.Percentage, PromotionRewardType.FixedAmount])
  rewardType!: PromotionRewardType.Percentage | PromotionRewardType.FixedAmount;
  @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) rewardValue!: number;
}

export class PromotionAdvancedRuleDto {
  @IsEnum(AdvancedPromotionType) type!: AdvancedPromotionType;
  @IsOptional() @IsBoolean() repeatable?: boolean;
  @IsOptional() @ValidateNested() @Type(() => PromotionRuleGroupDto) buy?: PromotionRuleGroupDto;
  @IsOptional() @ValidateNested() @Type(() => PromotionRuleGroupDto) get?: PromotionRuleGroupDto;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ValidateNested({ each: true }) @Type(() => PromotionRuleGroupDto) bundleComponents?: PromotionRuleGroupDto[];
  @IsOptional() @ValidateNested() @Type(() => PromotionRuleGroupDto) quantityTarget?: PromotionRuleGroupDto;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => PromotionQuantityTierDto) tiers?: PromotionQuantityTierDto[];
}

export class CreatePromotionDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() isActive = false;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @ValidateNested() @Type(() => PromotionScheduleDto) schedule?: PromotionScheduleDto | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) priority = 0;
  @IsEnum(PromotionRewardType) rewardType!: PromotionRewardType;
  @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) rewardValue!: number;
  @IsOptional() @IsBoolean() entireOrder = false;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minimumSubtotalToman?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) maxDiscountToman?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,64}$/) couponCode?: string;
  @IsOptional() @IsBoolean() couponActive?: boolean;
  @IsOptional() @IsDateString() couponStartsAt?: string | null;
  @IsOptional() @IsDateString() couponExpiresAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) totalUsageLimit?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perCustomerUsageLimit?: number | null;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PromotionTargetDto) targets!: PromotionTargetDto[];
  @IsOptional() @ValidateNested() @Type(() => PromotionAdvancedRuleDto) advancedRule?: PromotionAdvancedRuleDto;
}

export class UpdatePromotionDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsOptional() @IsDateString() endAt?: string | null;
  @IsOptional() @ValidateNested() @Type(() => PromotionScheduleDto) schedule?: PromotionScheduleDto | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1000000) priority?: number;
  @IsOptional() @IsEnum(PromotionRewardType) rewardType?: PromotionRewardType;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) rewardValue?: number;
  @IsOptional() @IsBoolean() entireOrder?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(Number.MAX_SAFE_INTEGER) minimumSubtotalToman?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(Number.MAX_SAFE_INTEGER) maxDiscountToman?: number | null;
  @IsOptional() @IsString() @Matches(/^[A-Za-z0-9_-]{3,64}$/) couponCode?: string;
  @IsOptional() @IsBoolean() couponActive?: boolean;
  @IsOptional() @IsDateString() couponStartsAt?: string | null;
  @IsOptional() @IsDateString() couponExpiresAt?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) totalUsageLimit?: number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) perCustomerUsageLimit?: number | null;
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PromotionTargetDto) targets?: PromotionTargetDto[];
  @IsOptional() @ValidateNested() @Type(() => PromotionAdvancedRuleDto) advancedRule?: PromotionAdvancedRuleDto | null;
}
