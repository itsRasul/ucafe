import { Type } from "class-transformer";
import { IsArray, IsBoolean, IsIn, IsInt, IsLatitude, IsLongitude, IsOptional, IsString, IsUrl, Matches, MaxLength, Min, Max, ValidateNested, ValidateIf } from "class-validator";
import { RadiusPreset } from "../entities";

export class OpeningHourDto {
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek!: number;

  @IsBoolean()
  isClosed!: boolean;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  opensAt?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  closesAt?: string;
}

export class UpdateSiteDto {
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/\S/) @MaxLength(160) name?: string;
  @ValidateIf((_object, value) => value !== undefined) @IsString() @Matches(/\S/) @MaxLength(160) branchName?: string;
  @IsOptional() @IsString() @MaxLength(140) heroTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(320) heroSubtitle?: string | null;
  @IsOptional() @IsString() @MaxLength(140) aboutTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) aboutBody?: string | null;
  @IsOptional() @IsString() @MaxLength(180) announcementText?: string | null;
  @IsOptional() @IsUrl({ protocols: ["https"], require_protocol: true }) @MaxLength(300) instagramUrl?: string | null;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) primaryColor?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) secondaryColor?: string;
  @IsOptional() @Matches(/^#[0-9A-Fa-f]{6}$/) accentColor?: string;
  @IsOptional() @IsIn(["Estedad", "Vazirmatn", "Peyda"]) headingFont?: string;
  @IsOptional() @IsIn(["Vazirmatn", "Estedad"]) bodyFont?: string;
  @IsOptional() @IsIn(Object.values(RadiusPreset)) radiusPreset?: RadiusPreset;

  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) address?: string | null;
  @IsOptional() @IsLatitude() latitude?: string | null;
  @IsOptional() @IsLongitude() longitude?: string | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OpeningHourDto)
  openingHours?: OpeningHourDto[];
}
