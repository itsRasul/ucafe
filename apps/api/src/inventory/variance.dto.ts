import { Type } from "class-transformer";
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from "class-validator";

export class InventoryVarianceIntervalDto {
  @IsUUID() locationId!: string;
  @IsUUID() openingCountId!: string;
  @IsUUID() closingCountId!: string;
}

export class InventoryVarianceQueryDto extends InventoryVarianceIntervalDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsIn(["itemName", "variance", "variancePercent"]) sortBy: "itemName" | "variance" | "variancePercent" = "variance";
  @IsOptional() @IsIn(["ASC", "DESC"]) sortDirection: "ASC" | "DESC" = "DESC";
  @IsOptional() @IsIn(["ALL", "POSITIVE", "NEGATIVE", "ZERO"]) varianceDirection: "ALL" | "POSITIVE" | "NEGATIVE" | "ZERO" = "ALL";
}
