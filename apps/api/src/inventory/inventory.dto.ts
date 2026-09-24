import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";
import { InventoryDimension, InventoryStockAlertStatus, InventoryStockAlertType, InventoryStockStatus, InventoryWasteReason, InventoryWasteStatus } from "./entities";

const quantity = /^\d{1,14}(?:\.\d{1,6})?$/;
export class InitialBatchDto {
  @Matches(quantity) quantity!: string;
  @IsOptional() @IsString() @MaxLength(100) supplierLotNumber?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) manufacturedDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate?: string;
}

export class CreateInventoryItemDto {
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(140) name!: string;
  @IsEnum(InventoryDimension) dimension!: InventoryDimension;
  @IsIn(["g", "kg", "ml", "l", "piece", "pack", "box", "bottle"]) baseUnit!: string;
  @IsOptional() @IsString() @MaxLength(80) sku?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @Matches(quantity) openingQuantity?: string;
  @IsOptional() @IsBoolean() batchTrackingEnabled?: boolean;
  @IsOptional() @IsBoolean() expiryTrackingEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) expiryWarningDays?: number;
  @IsOptional() @IsArray() @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => InitialBatchDto) openingBatches?: InitialBatchDto[];
}
export class UpdateInventoryItemDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(140) name?: string;
  @IsOptional() @IsString() @MaxLength(80) sku?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsUUID() categoryId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() batchTrackingEnabled?: boolean;
  @IsOptional() @IsBoolean() expiryTrackingEnabled?: boolean;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(365) expiryWarningDays?: number;
}
export class CreateInventoryLocationDto { @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(120) name!: string; @IsOptional() @IsBoolean() isDefault?: boolean; }
export class UpdateInventoryLocationDto { @IsOptional() @IsString() @Matches(/\S/) @MaxLength(120) name?: string; @IsOptional() @IsBoolean() isDefault?: boolean; @IsOptional() @IsBoolean() isActive?: boolean; }
export class CreateInventoryCategoryDto { @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(80) name!: string; }
export class UpdateInventoryCategoryDto { @IsOptional() @IsString() @Matches(/\S/) @MaxLength(80) name?: string; @IsOptional() @IsBoolean() isActive?: boolean; }
export class StockAdjustmentDto {
  @IsUUID() itemId!: string;
  @IsUUID() locationId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @Matches(/^-?\d{1,14}(?:\.\d{1,6})?$/) quantity!: string;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(120) reason!: string;
  @IsString() @MaxLength(100) idempotencyKey!: string;
}
export class CountLineDto { @IsUUID() itemId!: string; @IsOptional() @IsUUID() batchId?: string; @IsOptional() @IsIn(["AGGREGATE","BATCH","UNALLOCATED"]) allocationType?: "AGGREGATE"|"BATCH"|"UNALLOCATED"; @Matches(quantity) countedQuantity!: string; }
export class UpdateStockCountLinesDto { @IsArray() @ArrayMaxSize(500) @ValidateNested({ each: true }) @Type(() => CountLineDto) lines!: CountLineDto[]; }
export class CreateStockCountDto { @IsUUID() locationId!: string; @IsOptional() @IsString() @MaxLength(500) note?: string; }
export class InventoryListQueryDto {
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsIn(["true", "false"]) active?: string;
  @IsOptional() @IsEnum(InventoryStockStatus) stockStatus?: InventoryStockStatus;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
}
export class MovementListQueryDto extends InventoryListQueryDto {
  @IsOptional() @IsIn(["OPENING_BALANCE", "PURCHASE_RECEIPT", "SALE_CONSUMPTION", "SALE_REVERSAL", "WASTE", "MANUAL_ADJUSTMENT", "STOCK_COUNT_ADJUSTMENT"]) type?: string;
  @IsOptional() @IsDateString({strict:true}) from?: string;
  @IsOptional() @IsDateString({strict:true}) to?: string;
  @IsOptional() @IsUUID() batchId?: string;
}

export class InventoryBatchListQueryDto extends InventoryListQueryDto {
  @IsOptional() @IsIn(["ACTIVE", "EXPIRING_SOON", "EXPIRED", "NO_EXPIRY", "DEPLETED", "ALL"]) status?: string;
  @IsOptional() @IsUUID() supplierId?: string;
}
export class InventoryItemBatchQueryDto { @IsOptional() @IsUUID() locationId?: string; }

export class WasteRecordItemDto {
  @IsUUID() inventoryItemId!: string;
  @IsOptional() @IsUUID() batchId?: string;
  @Matches(quantity) quantity!: string;
  @IsString() @MaxLength(16) unit!: string;
}

export class UpdateInventoryBatchDto {
  @IsOptional() @IsString() @MaxLength(100) supplierLotNumber?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) manufacturedDate?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate?: string | null;
  @IsString() @IsNotEmpty() @Matches(/\S/) @MaxLength(240) reason!: string;
}

export class CreateWasteRecordDto {
  @IsUUID() locationId!: string;
  @IsEnum(InventoryWasteReason) reason!: InventoryWasteReason;
  @IsOptional() @IsDateString() wastedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(() => WasteRecordItemDto) items!: WasteRecordItemDto[];
}

export class UpdateWasteRecordDto {
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @IsEnum(InventoryWasteReason) reason?: InventoryWasteReason;
  @IsOptional() @IsDateString() wastedAt?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({each:true}) @Type(() => WasteRecordItemDto) items?: WasteRecordItemDto[];
}

export class WasteListQueryDto extends InventoryListQueryDto {
  @IsOptional() @IsEnum(InventoryWasteReason) reason?: InventoryWasteReason;
  @IsOptional() @IsEnum(InventoryWasteStatus) status?: InventoryWasteStatus;
  @IsOptional() @IsDateString({strict:true}) from?: string;
  @IsOptional() @IsDateString({strict:true}) to?: string;
}

export class InventoryStockSettingsDto {
  @IsUUID() locationId!: string;
  @IsOptional() @IsIn(["g", "kg", "ml", "l", "piece", "pack", "box", "bottle"]) unit?: string;
  @IsOptional() @Matches(quantity) minimumQuantity?: string | null;
  @IsOptional() @Matches(quantity) parQuantity?: string | null;
}

export class StockAlertListQueryDto {
  @IsOptional() @IsIn([InventoryStockAlertStatus.Open, InventoryStockAlertStatus.Resolved, "ALL"]) status?: string;
  @IsOptional() @IsEnum(InventoryStockAlertType) type?: InventoryStockAlertType;
  @IsOptional() @IsUUID() itemId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1_000_000) page = 1;
}
