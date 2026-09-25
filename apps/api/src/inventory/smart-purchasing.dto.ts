import { IsBoolean, IsIn, IsOptional, IsUUID, Matches } from "class-validator";
import { InventoryListQueryDto } from "./inventory.dto";
import { PurchasingListQueryDto } from "./purchasing.dto";

const quantity = /^\d{1,14}(?:\.\d{1,6})?$/;

export class ReplenishmentQueryDto extends InventoryListQueryDto {}

export class SupplierItemPreferenceDto {
  @IsOptional() @IsBoolean() isPreferred?: boolean;
  @IsOptional() @IsIn(["g", "kg", "ml", "l", "piece", "pack", "box", "bottle"]) purchaseUnit?: string | null;
  @IsOptional() @Matches(quantity) minimumOrderQuantity?: string | null;
}

export class SupplierPriceHistoryQueryDto extends PurchasingListQueryDto {
  @IsUUID() supplierId!: string;
}
