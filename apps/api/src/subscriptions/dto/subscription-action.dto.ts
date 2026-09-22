import { IsInt, IsOptional, IsString, Matches, MaxLength, Min } from "class-validator";

export class PreviewSubscriptionDto {
  @IsString() @MaxLength(40) @Matches(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) planKey!: string;
}

export class SchedulePlanDto extends PreviewSubscriptionDto {
  @IsInt() @Min(0) expectedSubscriptionVersion!: number;
}

export class CancelScheduledPlanDto {
  @IsOptional() @IsInt() @Min(0) expectedSubscriptionVersion?: number;
}
