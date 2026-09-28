import { Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

export class UpdateTenantCrmLoyaltyProgramDto {
  @IsBoolean() enabled!: boolean;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) spendPerPointToman!: number;
}

export class CreateTenantCrmRewardDto {
  @IsString() @MaxLength(120) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) pointsCost!: number;
}

export class UpdateTenantCrmRewardDto {
  @IsOptional() @IsString() @MaxLength(120) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) pointsCost?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class TenantCrmLoyaltyListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class AdjustTenantCrmLoyaltyDto {
  @IsIn(["CREDIT", "DEBIT"]) direction!: "CREDIT" | "DEBIT";
  @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000_000) points!: number;
  @IsString() @MaxLength(500) reason!: string;
  @IsString() @Matches(/^(?!ORDER:|REDEMPTION:)[A-Za-z0-9:_-]{8,120}$/) idempotencyKey!: string;
}

export class RedeemTenantCrmRewardDto {
  @IsUUID() rewardId!: string;
  @IsString() @Matches(/^[A-Za-z0-9:_-]{8,120}$/) idempotencyKey!: string;
}
