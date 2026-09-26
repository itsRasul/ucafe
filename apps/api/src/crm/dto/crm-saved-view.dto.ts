import { Transform, Type } from "class-transformer";
import { IsIn, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";
import { CrmCustomFieldEntityType } from "../entities/crm-custom-field.entity";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const entityTypes = Object.values(CrmCustomFieldEntityType);

export class CrmSavedViewListQueryDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
}

export class CreateCrmSavedViewDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @IsIn(["PRIVATE", "SHARED"]) visibility!: "PRIVATE" | "SHARED";
  @IsObject() filterDefinition!: Record<string, unknown>;
  @IsOptional() @IsObject() queryDefinition?: Record<string, unknown>;
  @IsOptional() @IsObject() sortDefinition?: Record<string, unknown> | null;
}

export class UpdateCrmSavedViewDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @IsIn(["PRIVATE", "SHARED"]) visibility?: "PRIVATE" | "SHARED";
  @IsOptional() @IsObject() filterDefinition?: Record<string, unknown>;
  @IsOptional() @IsObject() queryDefinition?: Record<string, unknown>;
  @IsOptional() @IsObject() sortDefinition?: Record<string, unknown> | null;
}

export class CreateCrmSegmentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @IsObject() filterDefinition!: Record<string, unknown>;
}

export class UpdateCrmSegmentDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsObject() filterDefinition?: Record<string, unknown>;
}

export class CrmSegmentListQueryDto {
  @IsOptional() @IsIn(entityTypes) entityType?: CrmCustomFieldEntityType;
}

export class CrmSegmentPreviewDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @IsObject() filterDefinition!: Record<string, unknown>;
}

export class CrmSegmentRecordsQueryDto {
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}
