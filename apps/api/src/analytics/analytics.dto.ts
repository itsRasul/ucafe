import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from "class-validator";
import { ANALYTICS_PERIODS, AnalyticsPeriod } from "./analytics-period";
import { AdvancedPromotionType, PromotionRewardType } from "../promotions/entities";

export class AnalyticsQueryDto {
  @IsOptional() @IsIn(ANALYTICS_PERIODS) period: AnalyticsPeriod = "today";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) start?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) end?: string;
}

export class ProductAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
}

export class CustomerAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) limit = 10;
}

export class PromotionAnalyticsQueryDto extends AnalyticsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
  @IsOptional() @IsIn(["AUTOMATIC", "COUPON"]) activation?: "AUTOMATIC" | "COUPON";
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE", "ARCHIVED"]) status?: "ACTIVE" | "INACTIVE" | "ARCHIVED";
  @IsOptional() @IsIn([...Object.values(AdvancedPromotionType), ...Object.values(PromotionRewardType)]) promotionType?: AdvancedPromotionType | PromotionRewardType;
  @IsOptional() @IsIn(["uses", "discount", "attributedSales", "averageOrderValue"]) sortBy: "uses" | "discount" | "attributedSales" | "averageOrderValue" = "uses";
}

export interface AnalyticsMetric {
  value: string;
  previousValue: string;
  change: string;
  changePercent: string | null;
}

export interface AnalyticsPoint { bucket: string; label: string; value: string }
export interface AnalyticsSeries { key: string; label: string; points: AnalyticsPoint[] }

export function compareMetric(current: bigint, previous: bigint): AnalyticsMetric {
  const change = current - previous;
  const scaled = previous === 0n ? null : change * 10000n / previous;
  const absolute = scaled === null ? null : scaled < 0n ? -scaled : scaled;
  return {
    value: current.toString(), previousValue: previous.toString(), change: change.toString(),
    changePercent: scaled === null ? null : `${scaled < 0n ? "-" : ""}${absolute! / 100n}.${String(absolute! % 100n).padStart(2, "0")}`,
  };
}

export function percentOf(value: bigint, total: bigint): string {
  if (total === 0n) return "0.00";
  const scaled = value * 10000n / total;
  return `${scaled / 100n}.${String(scaled % 100n).padStart(2, "0")}`;
}
