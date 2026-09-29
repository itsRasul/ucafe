import { Transform, Type } from "class-transformer";
import { IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateIf } from "class-validator";
import { SupportTicketDepartment, SupportTicketStatus } from "../entities";

const trim = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() : value;
const trimOptional = ({ value }: { value: unknown }) => typeof value === "string" ? value.trim() || undefined : value;
const omitEmpty = ({ value }: { value: unknown }) => value === "" ? undefined : value;

export class CreateSupportTicketDto {
  @IsEnum(SupportTicketDepartment) department!: SupportTicketDepartment;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(160) subject!: string;
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) message!: string;
}

export class CreateSupportTicketMessageDto {
  @Transform(trim) @IsString() @MinLength(1) @MaxLength(10000) message!: string;
}

export class TenantSupportTicketListQueryDto {
  @Transform(omitEmpty) @IsOptional() @IsEnum(SupportTicketStatus) status?: SupportTicketStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class PlatformSupportTicketListQueryDto extends TenantSupportTicketListQueryDto {
  @Transform(omitEmpty) @IsOptional() @IsEnum(SupportTicketDepartment) department?: SupportTicketDepartment;
  @Transform(omitEmpty) @IsOptional() @IsUUID() tenantId?: string;
  @IsOptional() @Transform(trimOptional) @IsString() @MinLength(1) @MaxLength(120) search?: string;
  @IsOptional() @Transform(trimOptional) @IsString() @MinLength(1) @MaxLength(120) tenantSearch?: string;
  @IsOptional() @Transform(trimOptional) @IsString() @Matches(/^UC-\d+$/i) @MaxLength(24) referenceNumber?: string;
}

export class UpdateSupportTicketDto {
  @IsIn(["CLOSE", "REOPEN", "CHANGE_DEPARTMENT"]) action!: "CLOSE" | "REOPEN" | "CHANGE_DEPARTMENT";
  @ValidateIf((input: UpdateSupportTicketDto) => input.action === "CHANGE_DEPARTMENT" || input.department !== undefined)
  @IsEnum(SupportTicketDepartment)
  department?: SupportTicketDepartment;
}
