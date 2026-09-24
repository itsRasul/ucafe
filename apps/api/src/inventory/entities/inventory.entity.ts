import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum InventoryDimension { Weight = "WEIGHT", Volume = "VOLUME", Count = "COUNT" }
export enum InventoryMovementType { OpeningBalance = "OPENING_BALANCE", PurchaseReceipt = "PURCHASE_RECEIPT", SaleConsumption = "SALE_CONSUMPTION", SaleReversal = "SALE_REVERSAL", Waste = "WASTE", ManualAdjustment = "MANUAL_ADJUSTMENT", StockCountAdjustment = "STOCK_COUNT_ADJUSTMENT", TransferIn = "TRANSFER_IN", TransferOut = "TRANSFER_OUT", ProductionConsumption = "PRODUCTION_CONSUMPTION", ProductionOutput = "PRODUCTION_OUTPUT" }
export enum InventoryCountStatus { Draft = "DRAFT", Completed = "COMPLETED" }
export enum InventoryWasteReason { Expired = "EXPIRED", Damaged = "DAMAGED", Spilled = "SPILLED", PreparationError = "PREPARATION_ERROR", CustomerReturn = "CUSTOMER_RETURN", QualityIssue = "QUALITY_ISSUE", Overproduction = "OVERPRODUCTION", StaffUse = "STAFF_USE", Training = "TRAINING", Other = "OTHER" }
export enum InventoryWasteStatus { Draft = "DRAFT", Posted = "POSTED", Reversed = "REVERSED" }
export enum InventoryStockStatus { Negative = "NEGATIVE", OutOfStock = "OUT_OF_STOCK", LowStock = "LOW_STOCK", BelowPar = "BELOW_PAR", Ok = "OK" }
export enum InventoryStockAlertType { Negative = "NEGATIVE", OutOfStock = "OUT_OF_STOCK", LowStock = "LOW_STOCK", BatchExpiringSoon = "BATCH_EXPIRING_SOON", BatchExpired = "BATCH_EXPIRED" }
export enum InventoryStockAlertStatus { Open = "OPEN", Resolved = "RESOLVED" }

@Entity("inventory_categories")
export class InventoryCategory {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 80 }) name!: string;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_items")
@Index("UQ_inventory_items_tenant_sku", ["coffeeShopId", "sku"], { unique: true, where: '"sku" IS NOT NULL' })
export class InventoryItem {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 140 }) name!: string;
  @Column({ type: "varchar", length: 80, nullable: true }) sku!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) description!: string | null;
  @Column({ name: "category_id", type: "uuid", nullable: true }) categoryId!: string | null;
  @Column({ type: "enum", enum: InventoryDimension, enumName: "inventory_dimension" }) dimension!: InventoryDimension;
  @Column({ name: "base_unit", type: "varchar", length: 16 }) baseUnit!: string;
  @Column({ name: "batch_tracking_enabled", type: "boolean", default: false }) batchTrackingEnabled!: boolean;
  @Column({ name: "expiry_tracking_enabled", type: "boolean", default: false }) expiryTrackingEnabled!: boolean;
  @Column({ name: "expiry_warning_days", type: "smallint", default: 3 }) expiryWarningDays!: number;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_stock_counts")
export class InventoryStockCount {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ type: "enum", enum: InventoryCountStatus, enumName: "inventory_count_status", default: InventoryCountStatus.Draft }) status!: InventoryCountStatus;
  @Column({ type: "varchar", length: 500, nullable: true }) note!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid" }) createdByUserId!: string;
  @Column({ name: "completed_by_user_id", type: "uuid", nullable: true }) completedByUserId!: string | null;
  @Column({ name: "completed_at", type: "timestamptz", nullable: true }) completedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_stock_count_lines")
export class InventoryStockCountLine {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "count_id", type: "uuid" }) countId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "batch_id", type: "uuid", nullable: true }) batchId!: string | null;
  @Column({ name: "allocation_type", type: "varchar", length: 16, default: "AGGREGATE" }) allocationType!: string;
  @Column({ name: "expected_quantity", type: "numeric", precision: 20, scale: 6 }) expectedQuantity!: string;
  @Column({ name: "counted_quantity", type: "numeric", precision: 20, scale: 6 }) countedQuantity!: string;
  @Column({ name: "counted_at", type: "timestamptz" }) countedAt!: Date;
  @Column({ name: "variance_quantity", type: "numeric", precision: 20, scale: 6, nullable: true }) varianceQuantity!: string | null;
  @Column({ name: "movement_id", type: "uuid", nullable: true }) movementId!: string | null;
}

@Entity("inventory_locations")
@Index("UQ_inventory_locations_default", ["coffeeShopId"], { unique: true, where: '"is_default" = true' })
export class InventoryLocation {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 120 }) name!: string;
  @Column({ name: "is_default", type: "boolean", default: false }) isDefault!: boolean;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_stock_movements")
@Index("IDX_inventory_movements_item_created", ["coffeeShopId", "itemId", "createdAt"])
@Index("UQ_inventory_movements_tenant_id", ["coffeeShopId", "id"], { unique: true })
@Index("UQ_inventory_movements_order_consumption", ["coffeeShopId", "sourceId", "orderItemId", "recipeComponentId"], { unique: true, where: "type = 'SALE_CONSUMPTION' AND source_type = 'ORDER_CONSUMPTION'" })
@Index("UQ_inventory_movements_reversal", ["coffeeShopId", "reversalOfMovementId"], { unique: true, where: '"reversal_of_movement_id" IS NOT NULL' })
export class InventoryStockMovement {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "batch_id", type: "uuid", nullable: true }) batchId!: string | null;
  @Column({ type: "enum", enum: InventoryMovementType, enumName: "inventory_movement_type" }) type!: InventoryMovementType;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6 }) quantityBase!: string;
  @Column({ name: "unit_cost_toman", type: "numeric", precision: 20, scale: 6, nullable: true }) unitCostToman!: string | null;
  @Column({ name: "source_type", type: "varchar", length: 40, nullable: true }) sourceType!: string | null;
  @Column({ name: "source_id", type: "varchar", length: 100, nullable: true }) sourceId!: string | null;
  @Column({ name: "source_line_id", type: "varchar", length: 100, nullable: true }) sourceLineId!: string | null;
  @Column({ name: "total_cost_toman", type: "bigint", nullable: true }) totalCostToman!: string | null;
  @Column({ name: "order_item_id", type: "uuid", nullable: true }) orderItemId!: string | null;
  @Column({ name: "recipe_version_id", type: "uuid", nullable: true }) recipeVersionId!: string | null;
  @Column({ name: "recipe_component_id", type: "uuid", nullable: true }) recipeComponentId!: string | null;
  @Column({ name: "reversal_of_movement_id", type: "uuid", nullable: true }) reversalOfMovementId!: string | null;
  @Column({ name: "idempotency_key", type: "varchar", length: 100, nullable: true }) idempotencyKey!: string | null;
  @Column({ name: "actor_user_id", type: "uuid", nullable: true }) actorUserId!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) reason!: string | null;
  @Column({ type: "jsonb", default: () => "'{}'::jsonb" }) metadata!: Record<string, unknown>;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}

@Entity("inventory_stock_balances")
@Index("UQ_inventory_stock_balances_item_location", ["coffeeShopId", "itemId", "locationId"], { unique: true })
export class InventoryStockBalance {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6, default: "0" }) quantityBase!: string;
  @Column({ name: "average_unit_cost_toman", type: "numeric", precision: 20, scale: 6, nullable: true }) averageUnitCostToman!: string | null;
  @Column({ name: "updated_at", type: "timestamptz", default: () => "now()" }) updatedAt!: Date;
}

@Entity("inventory_stock_rules")
@Index("UQ_inventory_stock_rules_item_location", ["coffeeShopId", "itemId", "locationId"], { unique: true })
export class InventoryStockRule {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "minimum_quantity_base", type: "numeric", precision: 20, scale: 6, nullable: true }) minimumQuantityBase!: string | null;
  @Column({ name: "par_quantity_base", type: "numeric", precision: 20, scale: 6, nullable: true }) parQuantityBase!: string | null;
  @Column({ name: "display_unit", type: "varchar", length: 16 }) displayUnit!: string;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_stock_alerts")
@Index("IDX_inventory_stock_alerts_tenant_status", ["coffeeShopId", "status", "openedAt"])
export class InventoryStockAlert {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "batch_id", type: "uuid", nullable: true }) batchId!: string | null;
  @Column({ name: "alert_type", type: "varchar", length: 32 }) type!: InventoryStockAlertType;
  @Column({ type: "enum", enum: InventoryStockAlertStatus, enumName: "inventory_stock_alert_status", default: InventoryStockAlertStatus.Open }) status!: InventoryStockAlertStatus;
  @Column({ name: "opened_at", type: "timestamptz" }) openedAt!: Date;
  @Column({ name: "last_observed_at", type: "timestamptz" }) lastObservedAt!: Date;
  @Column({ name: "resolved_at", type: "timestamptz", nullable: true }) resolvedAt!: Date | null;
}

@Entity("inventory_waste_records")
@Index("IDX_inventory_waste_records_tenant_date", ["coffeeShopId", "wastedAt"])
@Index("UQ_inventory_waste_records_tenant_id", ["coffeeShopId", "id"], { unique: true })
export class InventoryWasteRecord {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "wasted_at", type: "timestamptz" }) wastedAt!: Date;
  @Column({ type: "enum", enum: InventoryWasteReason, enumName: "inventory_waste_reason" }) reason!: InventoryWasteReason;
  @Column({ type: "varchar", length: 1000, nullable: true }) note!: string | null;
  @Column({ type: "enum", enum: InventoryWasteStatus, enumName: "inventory_waste_status", default: InventoryWasteStatus.Draft }) status!: InventoryWasteStatus;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "posted_by_user_id", type: "uuid", nullable: true }) postedByUserId!: string | null;
  @Column({ name: "posted_at", type: "timestamptz", nullable: true }) postedAt!: Date | null;
  @Column({ name: "reversed_by_user_id", type: "uuid", nullable: true }) reversedByUserId!: string | null;
  @Column({ name: "reversed_at", type: "timestamptz", nullable: true }) reversedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_waste_items")
export class InventoryWasteItem {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "waste_record_id", type: "uuid" }) wasteRecordId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "batch_id", type: "uuid", nullable: true }) batchId!: string | null;
  @Column({ name: "item_name_snapshot", type: "varchar", length: 140 }) itemNameSnapshot!: string;
  @Column({ name: "quantity_display", type: "numeric", precision: 20, scale: 6 }) quantityDisplay!: string;
  @Column({ type: "varchar", length: 16 }) unit!: string;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6 }) quantityBase!: string;
  @Column({ name: "movement_id", type: "uuid", nullable: true }) movementId!: string | null;
}

@Entity("inventory_batches")
@Index("IDX_inventory_batches_allocation", ["coffeeShopId", "itemId", "locationId", "expiryDate", "receivedAt"])
@Index("UQ_inventory_batches_tenant_id", ["coffeeShopId", "id"], { unique: true })
export class InventoryBatch {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "supplier_lot_number", type: "varchar", length: 100, nullable: true }) supplierLotNumber!: string | null;
  @Column({ name: "manufactured_date", type: "date", nullable: true }) manufacturedDate!: string | null;
  @Column({ name: "expiry_date", type: "date", nullable: true }) expiryDate!: string | null;
  @Column({ name: "received_at", type: "timestamptz" }) receivedAt!: Date;
  @Column({ name: "original_quantity_base", type: "numeric", precision: 20, scale: 6 }) originalQuantityBase!: string;
  @Column({ name: "remaining_quantity_base", type: "numeric", precision: 20, scale: 6, default: "0" }) remainingQuantityBase!: string;
  @Column({ name: "unit_cost_toman", type: "numeric", precision: 20, scale: 6, nullable: true }) unitCostToman!: string | null;
  @Column({ name: "total_cost_toman", type: "bigint", nullable: true }) totalCostToman!: string | null;
  @Column({ name: "origin_type", type: "varchar", length: 24 }) originType!: string;
  @Column({ name: "goods_receipt_id", type: "uuid", nullable: true }) goodsReceiptId!: string | null;
  @Column({ name: "goods_receipt_line_id", type: "uuid", nullable: true }) goodsReceiptLineId!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_batch_changes")
export class InventoryBatchChange {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "batch_id", type: "uuid" }) batchId!: string;
  @Column({ name: "actor_user_id", type: "uuid", nullable: true }) actorUserId!: string | null;
  @Column({ type: "varchar", length: 240 }) reason!: string;
  @Column({ name: "old_supplier_lot_number", type: "varchar", length: 100, nullable: true }) oldSupplierLotNumber!: string | null;
  @Column({ name: "new_supplier_lot_number", type: "varchar", length: 100, nullable: true }) newSupplierLotNumber!: string | null;
  @Column({ name: "old_manufactured_date", type: "date", nullable: true }) oldManufacturedDate!: string | null;
  @Column({ name: "new_manufactured_date", type: "date", nullable: true }) newManufacturedDate!: string | null;
  @Column({ name: "old_expiry_date", type: "date", nullable: true }) oldExpiryDate!: string | null;
  @Column({ name: "new_expiry_date", type: "date", nullable: true }) newExpiryDate!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
