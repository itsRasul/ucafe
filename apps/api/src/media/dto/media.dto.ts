import { Type } from "class-transformer";
import { IsEnum, IsInt, IsNumber, IsOptional, Max, Min } from "class-validator";
import { MediaAssetKind } from "../entities";

export class UploadMediaDto {
  @IsEnum(MediaAssetKind) kind!: MediaAssetKind;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalX = 0.5;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalY = 0.5;
}

export class UploadMenuItemImageDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalX = 0.5;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalY = 0.5;
}

export class UpdateMediaDto {
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalX?: number;
  @IsOptional() @Type(() => Number) @IsNumber({ maxDecimalPlaces: 4 }) @Min(0) @Max(1) focalY?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(7) sortOrder?: number;
}
