import { Type } from "class-transformer";
import { IsIn, IsISO8601, IsOptional, Max, Min } from "class-validator";

export const CRM_TIMELINE_CATEGORIES = ["LEAD", "DEAL", "ACTIVITY", "TASK", "NOTE"] as const;
export type CrmTimelineCategory = typeof CRM_TIMELINE_CATEGORIES[number];

export class CrmTimelineQueryDto {
  @IsOptional() @IsIn(CRM_TIMELINE_CATEGORIES) category?: CrmTimelineCategory;
  @IsOptional() @IsISO8601({ strict: true }) dateFrom?: string;
  @IsOptional() @IsISO8601({ strict: true }) dateTo?: string;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 20;
}

export type CrmTimelineType =
  | "LEAD_CREATED" | "LEAD_STATUS_CHANGED" | "LEAD_QUALIFIED" | "LEAD_UNQUALIFIED" | "LEAD_CONVERTED"
  | "DEAL_CREATED" | "DEAL_STAGE_CHANGED" | "DEAL_WON" | "DEAL_LOST"
  | "ACTIVITY_LOGGED" | "TASK_CREATED" | "TASK_COMPLETED" | "TASK_CANCELED" | "TASK_REOPENED" | "NOTE_ADDED";

export interface CrmTimelineItem {
  id: string;
  type: CrmTimelineType;
  category: CrmTimelineCategory;
  occurredAt: string;
  actor: { userId: string | null; label: string | null; kind: "USER" | "SYSTEM" | "UNKNOWN" };
  title: string;
  description: string | null;
  organizationId: string;
  contactId: string | null;
  leadId: string | null;
  dealId: string | null;
  sourceType: string;
  sourceId: string;
  metadata: Record<string, unknown> | null;
}
