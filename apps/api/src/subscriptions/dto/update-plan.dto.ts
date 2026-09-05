import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from "class-validator";
import { PlanStatus } from "../entities";

export class UpdatePlanDto {
  @IsOptional() @IsString() @MaxLength(100) name?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1_000_000_000) priceToman?: number;
  @IsOptional() @IsEnum(PlanStatus) status?: PlanStatus;
  @IsOptional() @IsInt() @Min(0) @Max(90) trialDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(90) graceDays?: number;
}
