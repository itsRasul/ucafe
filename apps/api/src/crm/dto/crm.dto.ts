import { Transform, Type } from "class-transformer";
import { IsEmail, IsIn, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class CrmListQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(6000) filter?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) q?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsUUID() coffeeShopId?: string;
  @IsOptional() @IsIn(["LINKED", "UNLINKED"]) tenantLink?: "LINKED" | "UNLINKED";
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveStatus: "ACTIVE" | "ARCHIVED" | "ALL" = "ACTIVE";
  @IsOptional() @IsIn(["createdAt", "name", "city"]) sort: "createdAt" | "name" | "city" = "createdAt";
  @IsOptional() @IsIn(["ASC", "DESC"]) direction: "ASC" | "DESC" = "DESC";
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 25;
}

export class CreateOrganizationDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string | null;
}

export class UpdateOrganizationDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string | null;
}

export class LinkTenantDto {
  @IsUUID() coffeeShopId!: string;
}

export class OrganizationDuplicateQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) city?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) website?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(255) instagram?: string;
  @IsOptional() @IsUUID() excludeId?: string;
}

export class CrmContactListQueryDto extends CrmListQueryDto {
  @IsOptional() @IsUUID() organizationId?: string;
}

export class CreateContactDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) role?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_object, value) => value !== "") @IsEmail() @MaxLength(254) email?: string | null;
}

export class UpdateContactDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) role?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string | null;
  @IsOptional() @Transform(trim) @ValidateIf((_object, value) => value !== "") @IsEmail() @MaxLength(254) email?: string | null;
}

export class ContactDuplicateQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(32) phone?: string;
  @IsOptional() @Transform(trim) @ValidateIf((_object, value) => value !== "") @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsUUID() excludeId?: string;
}

export class TenantLinkCandidatesQueryDto {
  @IsOptional() @IsUUID() organizationId?: string;
}
