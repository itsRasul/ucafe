import { Transform, Type } from "class-transformer";
import { IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;

export class TenantCrmSegmentListQueryDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class TenantCrmSegmentMembersQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class PreviewTenantCrmSegmentDto {
  @IsObject() criteria!: unknown;
}

export class CreateTenantCrmSegmentDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string;
  @IsObject() criteria!: unknown;
}

export class UpdateTenantCrmSegmentDto {
  @IsOptional() @Transform(trim) @IsString() @MinLength(1) @MaxLength(120) name?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsObject() criteria?: unknown;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
