import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { tenantCrmAutomationActions, tenantCrmAutomationTriggers } from "../tenant-crm-automation.util";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const statuses = ["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"] as const;
const executionStatuses = ["PENDING", "PROCESSING", "SUCCEEDED", "SKIPPED", "FAILED", "LOOP_BLOCKED"] as const;

export class TenantCrmAutomationActionDto {
  @IsIn(tenantCrmAutomationActions) type!: (typeof tenantCrmAutomationActions)[number];
  @IsObject() config!: Record<string, unknown>;
}

export class TenantCrmAutomationListQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsIn(statuses) status?: (typeof statuses)[number];
  @IsOptional() @IsIn(tenantCrmAutomationTriggers) triggerType?: (typeof tenantCrmAutomationTriggers)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class TenantCrmAutomationExecutionListQueryDto {
  @IsOptional() @IsIn(executionStatuses) status?: (typeof executionStatuses)[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateTenantCrmAutomationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(tenantCrmAutomationTriggers) triggerType!: (typeof tenantCrmAutomationTriggers)[number];
  @IsObject() triggerConfig!: Record<string, unknown>;
  @IsOptional() @IsObject() conditions?: Record<string, unknown> | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TenantCrmAutomationActionDto)
  actions!: TenantCrmAutomationActionDto[];
}

export class UpdateTenantCrmAutomationDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(tenantCrmAutomationTriggers) triggerType?: (typeof tenantCrmAutomationTriggers)[number];
  @IsOptional() @IsObject() triggerConfig?: Record<string, unknown>;
  @IsOptional() @IsObject() conditions?: Record<string, unknown> | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => TenantCrmAutomationActionDto)
  actions?: TenantCrmAutomationActionDto[];
}

export class PreviewTenantCrmAutomationDto {
  @IsIn(tenantCrmAutomationTriggers) triggerType!: (typeof tenantCrmAutomationTriggers)[number];
  @IsObject() triggerConfig!: Record<string, unknown>;
  @IsOptional() @IsObject() conditions?: Record<string, unknown> | null;
}
