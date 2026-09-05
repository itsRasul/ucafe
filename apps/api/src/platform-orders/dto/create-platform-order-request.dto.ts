import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsOptional, IsString, Matches, MaxLength } from "class-validator";
import { PlatformOrderBusinessStage, PlatformOrderService } from "../entities";

export class CreatePlatformOrderRequestDto {
  @IsString() @MaxLength(100) contactName!: string;
  @IsString() @MaxLength(160) coffeeShopName!: string;
  @IsString() @Matches(/^[\d۰-۹٠-٩\s()+-]{10,20}$/) phone!: string;
  @IsString() @MaxLength(100) city!: string;
  @IsEnum(PlatformOrderBusinessStage) businessStage!: PlatformOrderBusinessStage;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(5) @IsEnum(PlatformOrderService, { each: true }) requestedServices!: PlatformOrderService[];
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
