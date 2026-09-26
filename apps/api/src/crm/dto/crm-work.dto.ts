import { Transform, Type } from "class-transformer";
import { IsDateString, IsIn, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { CrmActivityType, CrmCallOutcome, CrmMeetingOutcome } from "../entities/crm-activity.entity";
import { CrmTaskKind, CrmTaskPriority, CrmTaskStatus } from "../entities/crm-task.entity";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const activityTypes = Object.values(CrmActivityType);
const activityOutcomes = [...Object.values(CrmCallOutcome), ...Object.values(CrmMeetingOutcome)];
const priorities = Object.values(CrmTaskPriority);
const kinds = Object.values(CrmTaskKind);
const statuses = Object.values(CrmTaskStatus);

class CrmWorkPageQueryDto {
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveStatus: "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE";
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}

export class CrmActivityListQueryDto extends CrmWorkPageQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(activityTypes) activityType?: CrmActivityType;
  @IsOptional() @IsIn(activityOutcomes) outcome?: string;
  @IsOptional() @IsUUID() actorUserId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsDateString() occurredFrom?: string;
  @IsOptional() @IsDateString() occurredTo?: string;
  @IsOptional() @IsIn(["occurredAt", "createdAt"]) sort: "occurredAt" | "createdAt" = "occurredAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "DESC";
}

export class CreateCrmActivityDto {
  @IsIn(activityTypes) activityType!: CrmActivityType;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) details?: string | null;
  @IsDateString() occurredAt!: string;
  @IsOptional() @IsIn(activityOutcomes) outcome?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}

export class UpdateCrmActivityDto {
  @IsOptional() @IsIn(activityTypes) activityType?: CrmActivityType;
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) subject?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) details?: string | null;
  @IsOptional() @IsDateString() occurredAt?: string;
  @IsOptional() @IsIn(activityOutcomes) outcome?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}

export class CrmTaskListQueryDto extends CrmWorkPageQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(200) q?: string;
  @IsOptional() @IsIn(statuses) status?: CrmTaskStatus;
  @IsOptional() @IsIn(priorities) priority?: CrmTaskPriority;
  @IsOptional() @IsIn(kinds) kind?: CrmTaskKind;
  @IsOptional() @ValidateIf((_object, value) => !["UNASSIGNED", "ME"].includes(value)) @IsUUID() assigneeId?: string;
  @IsOptional() @IsIn(["OPEN", "OVERDUE", "UPCOMING", "COMPLETED", "CANCELED", "NO_DUE_DATE"]) view?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsDateString() dueFrom?: string;
  @IsOptional() @IsDateString() dueTo?: string;
  @IsOptional() @IsIn(["dueAt", "priority", "createdAt", "updatedAt"]) sort: "dueAt" | "priority" | "createdAt" | "updatedAt" = "dueAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "ASC";
}

export class CreateCrmTaskDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsIn(kinds) kind?: CrmTaskKind;
  @IsOptional() @IsIn(priorities) priority?: CrmTaskPriority;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) assignedToUserId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}

export class UpdateCrmTaskDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsIn(kinds) kind?: CrmTaskKind;
  @IsOptional() @IsIn(priorities) priority?: CrmTaskPriority;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) assignedToUserId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}

export class CrmNoteListQueryDto extends CrmWorkPageQueryDto {
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsUUID() leadId?: string;
  @IsOptional() @IsUUID() dealId?: string;
  @IsOptional() @IsIn(["createdAt", "updatedAt"]) sort: "createdAt" | "updatedAt" = "createdAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "DESC";
}

export class CreateCrmNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(8000) body!: string;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}

export class UpdateCrmNoteDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(8000) body?: string;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) organizationId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) contactId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) leadId?: string | null;
  @IsOptional() @IsUUID() @ValidateIf((_object, value) => value !== null) dealId?: string | null;
}
