import { Transform, Type } from "class-transformer";
import { IsIn, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { CRM_DEFAULT_PIPELINE_KEY, CrmDealLossReason, CrmDealStage, CrmDealStatus } from "../entities/crm-deal.entity";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const stages = Object.values(CrmDealStage);
const statuses = Object.values(CrmDealStatus);
const lossReasons = Object.values(CrmDealLossReason);

export class CrmDealListQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(6000) filter?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(statuses) status?: CrmDealStatus;
  @IsOptional() @IsIn(stages) stage?: CrmDealStage;
  @IsOptional() @ValidateIf((_object, value) => value !== "UNASSIGNED") @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() expectedPlanId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedCloseFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedCloseTo?: string;
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveStatus: "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE";
  @IsOptional() @IsIn(["title", "createdAt", "updatedAt", "expectedCloseDate", "estimatedAmountToman"]) sort: "title" | "createdAt" | "updatedAt" | "expectedCloseDate" | "estimatedAmountToman" = "updatedAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "DESC";
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}

export class CreateCrmDealDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsUUID() organizationId!: string;
  @IsOptional() @IsUUID() primaryContactId?: string | null;
  @IsOptional() @IsUUID() originatingLeadId?: string | null;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsUUID() expectedPlanId?: string | null;
  @IsOptional() @IsIn(stages) stage?: CrmDealStage;
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,18})$/) estimatedAmountToman?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedCloseDate?: string | null;
}

export class UpdateCrmDealDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) primaryContactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) ownerId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) expectedPlanId?: string | null;
  @IsOptional() @IsString() @Matches(/^(0|[1-9]\d{0,18})$/) estimatedAmountToman?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedCloseDate?: string | null;
}

export class ChangeCrmDealStageDto {
  @IsIn(stages) expectedStage!: CrmDealStage;
  @IsIn(stages) stage!: CrmDealStage;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string | null;
}

export class LoseCrmDealDto {
  @IsIn(lossReasons) reason!: CrmDealLossReason;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) detail?: string | null;
}

export const crmDealPipelineKey = CRM_DEFAULT_PIPELINE_KEY;
