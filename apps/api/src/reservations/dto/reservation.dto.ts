import { Type } from "class-transformer";
import { IsBoolean, IsEnum, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { ReservationStatus } from "../entities";

export class AvailabilityQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) partySize!: number;
}

export class CreateReservationDto extends AvailabilityQueryDto {
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  @IsString() @MaxLength(100) contactName!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class UpdateReservationStatusDto {
  @IsIn([ReservationStatus.Confirmed, ReservationStatus.Rejected, ReservationStatus.Canceled, ReservationStatus.Completed, ReservationStatus.NoShow]) status!: ReservationStatus;
  @IsOptional() @IsString() @MaxLength(500) staffNote?: string;
}

export class AdminCreateReservationDto {
  @IsString() @MinLength(10) @MaxLength(32) phone!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(50) partySize!: number;
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
}

export class ReservationListQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @IsEnum(ReservationStatus) status?: ReservationStatus;
}

export class ClientReservationsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize = 10;
}

export class UpdateReservationSettingsDto {
  @IsOptional() @IsBoolean() isEnabled?: boolean;
  @IsOptional() @IsInt() @Min(15) @Max(120) slotIntervalMinutes?: number;
  @IsOptional() @IsInt() @Min(30) @Max(360) durationMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) minimumPartySize?: number;
  @IsOptional() @IsInt() @Min(1) @Max(50) maximumPartySize?: number;
  @IsOptional() @IsInt() @Min(1) @Max(500) maximumConcurrentGuests?: number;
  @IsOptional() @IsInt() @Min(0) @Max(10080) minimumLeadMinutes?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) maximumAdvanceDays?: number;
  @IsOptional() @IsBoolean() notifyAdminNewReservation?: boolean;
  @IsOptional() @IsInt() @Min(1) @Max(72) reminderHours?: number;
}

export class UpdateReservationDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) startTime?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) partySize?: number;
}
