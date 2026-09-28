import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsBoolean, IsDateString, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class TenantCrmNoteListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 20;
}

export class CreateTenantCrmNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class UpdateTenantCrmNoteDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

export class UpdateTenantCrmPreferencesDto {
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(80) preferredSeating?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(120) favoriteDrink?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(500) dietaryNotes?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(500) allergyNotes?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @Matches(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/) birthdayMonthDay?: string | null;
}

export class TenantCrmTagListQueryDto {
  @IsOptional() @IsIn(["true", "false"]) includeArchived?: string;
}

export class CreateTenantCrmTagDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name!: string;
}

export class UpdateTenantCrmTagDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name!: string;
}

export const tenantCrmCustomFieldTypes = ["TEXT", "LONG_TEXT", "NUMBER", "BOOLEAN", "DATE", "SINGLE_SELECT", "MULTI_SELECT", "URL"] as const;
export type TenantCrmCustomFieldType = (typeof tenantCrmCustomFieldTypes)[number];
export class TenantCrmCustomFieldOptionDto {
  @IsOptional() @IsUUID() id?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateTenantCrmCustomFieldDto {
  @Transform(trim) @IsString() @Matches(/^[a-z][a-z0-9_]{0,63}$/) key!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(tenantCrmCustomFieldTypes) dataType!: TenantCrmCustomFieldType;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TenantCrmCustomFieldOptionDto) options?: TenantCrmCustomFieldOptionDto[];
}

export class UpdateTenantCrmCustomFieldDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label?: string;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => TenantCrmCustomFieldOptionDto) options?: TenantCrmCustomFieldOptionDto[];
}

export class TenantCrmCustomFieldListQueryDto {
  @IsOptional() @IsIn(["true", "false"]) includeInactive?: string;
}

export class UpdateTenantCrmCustomFieldValuesDto {
  @IsObject() values!: Record<string, unknown>;
}

export class TenantCrmReminderListQueryDto {
  @IsOptional() @IsIn(["TODAY", "OVERDUE", "UPCOMING", "COMPLETED", "CANCELED", "ALL"]) view: "TODAY" | "OVERDUE" | "UPCOMING" | "COMPLETED" | "CANCELED" | "ALL" = "UPCOMING";
  @IsOptional() @IsUUID() clientId?: string;
  @IsOptional() @IsUUID() assignedToUserId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class CreateTenantCrmReminderDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(4000) description?: string | null;
  @IsDateString() dueAt!: string;
  @IsOptional() @IsUUID() @ValidateIf((_o, value) => value !== null) assignedToUserId?: string | null;
}

export class UpdateTenantCrmReminderDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @IsOptional() @Transform(trim) @ValidateIf((_o, value) => value !== null) @IsString() @MaxLength(4000) description?: string | null;
  @IsOptional() @IsDateString() dueAt?: string;
  @IsOptional() @IsUUID() @ValidateIf((_o, value) => value !== null) assignedToUserId?: string | null;
  @IsOptional() @IsIn(["OPEN", "COMPLETED", "CANCELED"]) status?: "OPEN" | "COMPLETED" | "CANCELED";
}
