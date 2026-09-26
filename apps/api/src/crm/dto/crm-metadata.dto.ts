import { Transform, Type } from "class-transformer";
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from "class-validator";
import { CrmCustomFieldEntityType, CrmCustomFieldType } from "../entities/crm-custom-field.entity";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const entityTypes = Object.values(CrmCustomFieldEntityType);
const fieldTypes = Object.values(CrmCustomFieldType);

export class CrmEntityTypeQueryDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @IsOptional() @IsIn(["true", "false"]) includeInactive?: string;
}

export class CrmRecordParamsDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @IsUUID() recordId!: string;
}

export class CreateCrmCustomFieldOptionDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
}

export class UpdateCrmCustomFieldOptionDto {
  @IsOptional() @IsUUID() id?: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @IsBoolean() active?: boolean;
}

export class CreateCrmCustomFieldDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
  @Transform(trim) @IsString() @Matches(/^[a-z][a-z0-9_]{0,63}$/) key!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsIn(fieldTypes) dataType!: CrmCustomFieldType;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CreateCrmCustomFieldOptionDto) options?: CreateCrmCustomFieldOptionDto[];
}

export class UpdateCrmCustomFieldDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) label?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsBoolean() required?: boolean;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10000) sortOrder?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => UpdateCrmCustomFieldOptionDto) options?: UpdateCrmCustomFieldOptionDto[];
}

export class CrmCustomFieldValuesDto {
  @IsObject() values!: Record<string, unknown>;
}

export class CrmTagListQueryDto {
  @IsOptional() @IsIn(["true", "false"]) includeArchived?: string;
}

export class CreateCrmTagDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(["gray", "blue", "green", "amber", "red", "purple"]) color?: string | null;
}

export class UpdateCrmTagDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsIn(["gray", "blue", "green", "amber", "red", "purple"]) color?: string | null;
}

export class CrmRecordTagsDto {
  @IsArray() @ArrayMaxSize(50) @ArrayUnique() @IsUUID(undefined, { each: true }) tagIds!: string[];
}

export class CrmFilterFieldsQueryDto {
  @IsIn(entityTypes) entityType!: CrmCustomFieldEntityType;
}
