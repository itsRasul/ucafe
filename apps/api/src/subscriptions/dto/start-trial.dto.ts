import { IsOptional, IsString, MaxLength } from "class-validator";

export class StartTrialDto {
  @IsOptional()
  @IsString()
  @MaxLength(40)
  planKey = "silver";
}
