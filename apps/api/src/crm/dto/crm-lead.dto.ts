import { Transform, Type } from "class-transformer";
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { CrmLeadPriority, CrmLeadSource, CrmLeadStatus, CrmLeadUnqualifiedReason } from "../entities/crm-lead.entity";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const sources = Object.values(CrmLeadSource);
const priorities = Object.values(CrmLeadPriority);
const reasons = Object.values(CrmLeadUnqualifiedReason);
const statuses = Object.values(CrmLeadStatus);

export class CrmLeadListQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(6000) filter?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) q?: string;
  @IsOptional() @IsIn(statuses) status?: CrmLeadStatus;
  @IsOptional() @IsIn(sources) source?: CrmLeadSource;
  @IsOptional() @IsIn(priorities) priority?: CrmLeadPriority;
  @IsOptional() @ValidateIf((_object, value) => value !== "UNASSIGNED") @IsUUID() ownerId?: string;
  @IsOptional() @IsUUID() organizationId?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveStatus: "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE";
  @IsOptional() @IsIn(["createdAt", "updatedAt", "priority", "status"]) sort: "createdAt" | "updatedAt" | "priority" | "status" = "createdAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "DESC";
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}

export class CreateCrmLeadDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) businessName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) contactName?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string | null;
  @IsIn(sources) source!: CrmLeadSource;
  @IsOptional() @IsIn(priorities) priority?: CrmLeadPriority;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsUUID() primaryContactId?: string | null;
  @IsOptional() @IsBoolean() allowPotentialDuplicates?: boolean;
}

export class UpdateCrmLeadDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) businessName?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) contactName?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsIn(priorities) priority?: CrmLeadPriority;
  @IsOptional() @IsUUID() ownerId?: string | null;
  @IsOptional() @IsUUID() organizationId?: string | null;
  @IsOptional() @IsUUID() primaryContactId?: string | null;
  @IsOptional() @IsBoolean() allowPotentialDuplicates?: boolean;
}

export class ChangeCrmLeadStatusDto {
  @IsIn([CrmLeadStatus.AttemptingContact, CrmLeadStatus.Contacted, CrmLeadStatus.Nurturing]) status!: CrmLeadStatus;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) reason?: string | null;
}

export class QualifyCrmLeadDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(2000) qualificationNotes?: string | null;
}

export class UnqualifyCrmLeadDto {
  @IsIn(reasons) reason!: CrmLeadUnqualifiedReason;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) detail?: string | null;
}

export class ConvertCrmLeadDto {
  @IsIn(["CREATE", "LINK"]) organizationMode!: "CREATE" | "LINK";
  @IsOptional() @IsUUID() organizationId?: string;
  @IsIn(["CREATE", "LINK"]) contactMode!: "CREATE" | "LINK";
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsBoolean() confirmPotentialDuplicates?: boolean;
}

export class CrmLeadDuplicateQueryDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) businessName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) contactName?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trim) @IsEmail() @MaxLength(254) email?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsUUID() excludeId?: string;
}
