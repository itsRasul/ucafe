import { Transform, Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export const tenantCrmFeedbackStatuses = ["NEW", "NEEDS_ATTENTION", "RESOLVED"] as const;
export type TenantCrmFeedbackStatus = (typeof tenantCrmFeedbackStatuses)[number];

export class TenantCrmFeedbackListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsIn(tenantCrmFeedbackStatuses) status?: TenantCrmFeedbackStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsIn(["MANUAL", "CUSTOMER_PANEL"]) source?: "MANUAL" | "CUSTOMER_PANEL";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
  @IsOptional() @IsIn(["createdAt", "rating", "updatedAt"]) sortBy: "createdAt" | "rating" | "updatedAt" = "createdAt";
  @IsOptional() @IsIn(["asc", "desc"]) sortOrder: "asc" | "desc" = "desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateTenantCrmFeedbackDto {
  @IsUUID() clientId!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) comment?: string | null;
}

export class SubmitTenantCrmFeedbackDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) comment?: string | null;
  @IsOptional() @IsUUID() orderId?: string;
  @IsOptional() @IsUUID() reservationId?: string;
}

export class ResolveTenantCrmFeedbackDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) resolutionNote?: string | null;
}
