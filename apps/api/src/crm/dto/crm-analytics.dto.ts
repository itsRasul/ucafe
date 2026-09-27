import { IsIn, IsOptional, IsUUID, Matches } from "class-validator";
import { ANALYTICS_PERIODS, AnalyticsPeriod } from "../../analytics/analytics-period";
import { CRM_DEFAULT_PIPELINE_KEY } from "../entities/crm-deal.entity";
import { CrmLeadSource } from "../entities/crm-lead.entity";

export class CrmAnalyticsQueryDto {
  @IsOptional() @IsIn(ANALYTICS_PERIODS) period: AnalyticsPeriod = "last30Days";
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) start?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) end?: string;
  @IsOptional() @Matches(/^(UNASSIGNED|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i) ownerId?: string;
  @IsOptional() @IsIn(Object.values(CrmLeadSource)) source?: CrmLeadSource;
  @IsOptional() @IsIn([CRM_DEFAULT_PIPELINE_KEY]) pipelineKey?: string;
  @IsOptional() @IsUUID() expectedPlanId?: string;
  @IsOptional() @IsUUID() subscriptionPlanId?: string;
}
