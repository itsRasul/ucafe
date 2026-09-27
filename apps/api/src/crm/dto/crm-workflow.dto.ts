import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CRM_WORKFLOW_ACTIONS, CRM_WORKFLOW_TRIGGERS } from "../crm-workflow.util";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const recordTypes = ["ORGANIZATION", "LEAD", "DEAL"];
const executionStatuses = ["PENDING", "RUNNING", "RETRYING", "SUCCEEDED", "FAILED"];

export class CreateCrmWorkflowDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(CRM_WORKFLOW_TRIGGERS) triggerType!: typeof CRM_WORKFLOW_TRIGGERS[number];
  @IsOptional() @IsObject() triggerConfig?: Record<string, unknown>;
  @IsIn(recordTypes) conditionEntityType!: "ORGANIZATION" | "LEAD" | "DEAL";
  @IsObject() conditions!: Record<string, unknown>;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsObject({ each: true }) actions!: Record<string, unknown>[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class UpdateCrmWorkflowDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(CRM_WORKFLOW_TRIGGERS) triggerType?: typeof CRM_WORKFLOW_TRIGGERS[number];
  @IsOptional() @IsObject() triggerConfig?: Record<string, unknown>;
  @IsOptional() @IsIn(recordTypes) conditionEntityType?: "ORGANIZATION" | "LEAD" | "DEAL";
  @IsOptional() @IsObject() conditions?: Record<string, unknown>;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(10) @IsObject({ each: true }) actions?: Record<string, unknown>[];
  @IsOptional() @IsBoolean() enabled?: boolean;
}

export class CrmWorkflowExecutionListDto {
  @IsOptional() @IsIn(executionStatuses) status?: typeof executionStatuses[number];
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}
