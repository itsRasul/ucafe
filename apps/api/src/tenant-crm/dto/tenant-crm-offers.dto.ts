import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, MaxLength, Min } from "class-validator";

export class TenantCrmOfferListQueryDto {
  @IsOptional() @IsIn(["DRAFT", "ACTIVE", "ENDED"]) status?: "DRAFT" | "ACTIVE" | "ENDED";
  @IsOptional() @IsString() @Length(1, 100) q?: string;
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class TenantCrmOfferClientsQueryDto {
  @Type(() => Number) @IsInt() @Min(1) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize = 25;
}

export class PreviewTenantCrmOfferDto {
  @IsUUID() segmentId!: string;
}

export class CreateTenantCrmOfferDto {
  @IsString() @Length(1, 120) @Matches(/\S/) name!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsUUID() promotionId!: string;
  @IsUUID() segmentId!: string;
}

export class UpdateTenantCrmOfferDto {
  @IsOptional() @IsString() @Length(1, 120) @Matches(/\S/) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsUUID() promotionId?: string;
  @IsOptional() @IsUUID() segmentId?: string;
}
