import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum PurchaseOrderStatus { Draft = "DRAFT", Ordered = "ORDERED", PartiallyReceived = "PARTIALLY_RECEIVED", Received = "RECEIVED", Canceled = "CANCELED" }
export enum GoodsReceiptStatus { Draft = "DRAFT", Posted = "POSTED" }

@Entity("inventory_suppliers")
@Index("IDX_inventory_suppliers_tenant_active", ["coffeeShopId", "isActive", "name"])
export class InventorySupplier {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ type: "varchar", length: 140 }) name!: string;
  @Column({ name: "contact_person", type: "varchar", length: 140, nullable: true }) contactPerson!: string | null;
  @Column({ type: "varchar", length: 40, nullable: true }) phone!: string | null;
  @Column({ type: "varchar", length: 254, nullable: true }) email!: string | null;
  @Column({ type: "varchar", length: 500, nullable: true }) address!: string | null;
  @Column({ type: "varchar", length: 1000, nullable: true }) notes!: string | null;
  @Column({ name: "is_active", type: "boolean", default: true }) isActive!: boolean;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_purchase_orders")
@Index("UQ_inventory_purchase_orders_number", ["coffeeShopId", "number"], { unique: true })
@Index("IDX_inventory_purchase_orders_tenant_status_date", ["coffeeShopId", "status", "createdAt"])
export class InventoryPurchaseOrder {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "supplier_id", type: "uuid" }) supplierId!: string;
  @Column({ type: "varchar", length: 24 }) number!: string;
  @Column({ name: "supplier_name_snapshot", type: "varchar", length: 140 }) supplierNameSnapshot!: string;
  @Column({ type: "enum", enum: PurchaseOrderStatus, enumName: "inventory_purchase_order_status", default: PurchaseOrderStatus.Draft }) status!: PurchaseOrderStatus;
  @Column({ name: "order_date", type: "date" }) orderDate!: string;
  @Column({ name: "expected_delivery_date", type: "date", nullable: true }) expectedDeliveryDate!: string | null;
  @Column({ type: "varchar", length: 1000, nullable: true }) notes!: string | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "ordered_by_user_id", type: "uuid", nullable: true }) orderedByUserId!: string | null;
  @Column({ name: "ordered_at", type: "timestamptz", nullable: true }) orderedAt!: Date | null;
  @Column({ name: "canceled_by_user_id", type: "uuid", nullable: true }) canceledByUserId!: string | null;
  @Column({ name: "canceled_at", type: "timestamptz", nullable: true }) canceledAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_purchase_order_items")
@Index("UQ_inventory_purchase_order_items_item", ["coffeeShopId", "purchaseOrderId", "itemId"], { unique: true })
export class InventoryPurchaseOrderItem {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "purchase_order_id", type: "uuid" }) purchaseOrderId!: string;
  @Column({ name: "inventory_item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "item_name_snapshot", type: "varchar", length: 140 }) itemNameSnapshot!: string;
  @Column({ name: "quantity_display", type: "numeric", precision: 20, scale: 6 }) quantityDisplay!: string;
  @Column({ type: "varchar", length: 16 }) unit!: string;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6 }) quantityBase!: string;
  @Column({ name: "unit_price_toman", type: "bigint" }) unitPriceToman!: string;
  @Column({ type: "varchar", length: 240, nullable: true }) note!: string | null;
}

@Entity("inventory_goods_receipts")
@Index("UQ_inventory_goods_receipts_number", ["coffeeShopId", "number"], { unique: true })
@Index("IDX_inventory_goods_receipts_tenant_status_date", ["coffeeShopId", "status", "createdAt"])
export class InventoryGoodsReceipt {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "supplier_id", type: "uuid" }) supplierId!: string;
  @Column({ name: "purchase_order_id", type: "uuid", nullable: true }) purchaseOrderId!: string | null;
  @Column({ type: "varchar", length: 24 }) number!: string;
  @Column({ name: "supplier_name_snapshot", type: "varchar", length: 140 }) supplierNameSnapshot!: string;
  @Column({ type: "enum", enum: GoodsReceiptStatus, enumName: "inventory_goods_receipt_status", default: GoodsReceiptStatus.Draft }) status!: GoodsReceiptStatus;
  @Column({ name: "over_receive_confirmed", type: "boolean", default: false }) overReceiveConfirmed!: boolean;
  @Column({ name: "supplier_invoice_number", type: "varchar", length: 100, nullable: true }) supplierInvoiceNumber!: string | null;
  @Column({ name: "delivery_note_number", type: "varchar", length: 100, nullable: true }) deliveryNoteNumber!: string | null;
  @Column({ type: "varchar", length: 1000, nullable: true }) notes!: string | null;
  @Column({ name: "received_at", type: "timestamptz", nullable: true }) receivedAt!: Date | null;
  @Column({ name: "created_by_user_id", type: "uuid", nullable: true }) createdByUserId!: string | null;
  @Column({ name: "posted_by_user_id", type: "uuid", nullable: true }) postedByUserId!: string | null;
  @Column({ name: "posted_at", type: "timestamptz", nullable: true }) postedAt!: Date | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" }) updatedAt!: Date;
}

@Entity("inventory_goods_receipt_lines")
@Index("IDX_inventory_goods_receipt_lines_order_item", ["coffeeShopId", "purchaseOrderItemId"])
export class InventoryGoodsReceiptLine {
  @PrimaryGeneratedColumn("uuid") id!: string;
  @Column({ name: "coffee_shop_id", type: "uuid" }) coffeeShopId!: string;
  @Column({ name: "goods_receipt_id", type: "uuid" }) goodsReceiptId!: string;
  @Column({ name: "purchase_order_item_id", type: "uuid", nullable: true }) purchaseOrderItemId!: string | null;
  @Column({ name: "inventory_item_id", type: "uuid" }) itemId!: string;
  @Column({ name: "item_name_snapshot", type: "varchar", length: 140 }) itemNameSnapshot!: string;
  @Column({ name: "location_id", type: "uuid" }) locationId!: string;
  @Column({ name: "quantity_display", type: "numeric", precision: 20, scale: 6 }) quantityDisplay!: string;
  @Column({ type: "varchar", length: 16 }) unit!: string;
  @Column({ name: "quantity_base", type: "numeric", precision: 20, scale: 6 }) quantityBase!: string;
  @Column({ name: "unit_price_toman", type: "bigint" }) unitPriceToman!: string;
  @Column({ name: "total_cost_toman", type: "bigint" }) totalCostToman!: string;
  @Column({ type: "varchar", length: 500, nullable: true }) note!: string | null;
  @Column({ name: "movement_id", type: "uuid", nullable: true }) movementId!: string | null;
  @CreateDateColumn({ name: "created_at", type: "timestamptz" }) createdAt!: Date;
}
