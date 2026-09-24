import { Type } from "class-transformer";
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, ValidateNested } from "class-validator";

const quantity = /^\d{1,14}(?:\.\d{1,6})?$/;
const money = /^(?:0|[1-9]\d{0,17})$/;
const date = /^\d{4}-\d{2}-\d{2}$/;

export class PurchasingListQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() status?: string;
}

export class CreateSupplierDto {
  @IsString() @Matches(/\S/) @MaxLength(140) name!: string;
  @IsOptional() @IsString() @MaxLength(140) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateSupplierDto {
  @IsOptional() @IsString() @Matches(/\S/) @MaxLength(140) name?: string;
  @IsOptional() @IsString() @MaxLength(140) contactPerson?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsString() @MaxLength(500) address?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class PurchaseOrderLineDto {
  @IsUUID() inventoryItemId!: string;
  @IsOptional() @IsUUID() locationId?: string;
  @Matches(quantity) quantity!: string;
  @IsString() @MaxLength(16) unit!: string;
  @Matches(money) unitPriceToman!: string;
  @IsOptional() @IsString() @MaxLength(240) note?: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID() supplierId!: string;
  @IsOptional() @Matches(date) orderDate?: string;
  @IsOptional() @Matches(date) expectedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto) items!: PurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @Matches(date) orderDate?: string;
  @IsOptional() @Matches(date) expectedDeliveryDate?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => PurchaseOrderLineDto) items?: PurchaseOrderLineDto[];
}

export class ReceiptBatchDto {
  @Matches(quantity) quantity!: string;
  @IsOptional() @IsString() @MaxLength(100) supplierLotNumber?: string;
  @IsOptional() @Matches(date) manufacturedDate?: string;
  @IsOptional() @Matches(date) expiryDate?: string;
}

export class GoodsReceiptLineDto {
  @IsUUID() inventoryItemId!: string;
  @IsOptional() @IsUUID() purchaseOrderItemId?: string;
  @IsOptional() @IsUUID() locationId?: string;
  @Matches(quantity) quantity!: string;
  @IsString() @MaxLength(16) unit!: string;
  @Matches(money) unitPriceToman!: string;
  @IsOptional() @IsString() @MaxLength(500) note?: string;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @ValidateNested({ each: true }) @Type(() => ReceiptBatchDto) batches?: ReceiptBatchDto[];
}

export class CreateGoodsReceiptDto {
  @IsOptional() @IsUUID() purchaseOrderId?: string;
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(100) supplierInvoiceNumber?: string;
  @IsOptional() @IsString() @MaxLength(100) deliveryNoteNumber?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GoodsReceiptLineDto) items!: GoodsReceiptLineDto[];
}

export class UpdateGoodsReceiptDto {
  @IsOptional() @IsUUID() supplierId?: string;
  @IsOptional() @IsString() @MaxLength(100) supplierInvoiceNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(100) deliveryNoteNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => GoodsReceiptLineDto) items?: GoodsReceiptLineDto[];
}

export class PostGoodsReceiptDto {
  @IsOptional() @IsBoolean() allowOverReceive?: boolean;
}
