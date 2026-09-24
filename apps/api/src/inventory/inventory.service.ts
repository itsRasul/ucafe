import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { CreateInventoryCategoryDto, CreateInventoryItemDto, CreateInventoryLocationDto, CreateStockCountDto, CreateWasteRecordDto, InitialBatchDto, InventoryBatchListQueryDto, InventoryListQueryDto, InventoryStockSettingsDto, MovementListQueryDto, StockAdjustmentDto, StockAlertListQueryDto, UpdateInventoryBatchDto, UpdateInventoryCategoryDto, UpdateInventoryItemDto, UpdateInventoryLocationDto, UpdateStockCountLinesDto, UpdateWasteRecordDto, WasteListQueryDto } from "./inventory.dto";
import { InventoryCountStatus, InventoryDimension, InventoryMovementType, InventoryStockAlertStatus, InventoryStockAlertType, InventoryStockStatus, InventoryWasteReason, InventoryWasteStatus } from "./entities";
import { addQuantities, multiplyQuantity, quantityFromBase, quantityToBase } from "./quantity.util";
import { compareQuantities, inventoryStockStatus } from "./stock.util";
import { RecipesService } from "./recipes.service";

type Row = { id: string; is_active: boolean; dimension: InventoryDimension; base_unit: string; batch_tracking_enabled?: boolean; expiry_tracking_enabled?: boolean };
type MovementOperation = { itemId:string; locationId:string; batchId?:string|null; type:InventoryMovementType; quantity:string; reason:string; idempotencyKey:string; sourceType:string; sourceId:string; sourceLineId?:string|null; unitCostToman?:string|null; totalCostToman?:string|null; orderItemId?:string|null; recipeVersionId?:string|null; recipeComponentId?:string|null; reversalOfMovementId?:string|null };
const uniqueConflict = (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw new ConflictException("Inventory name or SKU already exists");
  throw error;
};
const firstRow = <T>(rows: T[]) => { const row=rows[0]; return (Array.isArray(row)?row[0]:row) as T|undefined; };

@Injectable()
export class InventoryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(InventoryService.name);
  private expiryTimer?: NodeJS.Timeout;
  private lastExpirySweepDate = "";
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService, private readonly recipes: RecipesService) {}
  onModuleInit() { this.expiryTimer = setInterval(() => void this.scheduledExpirySweep(), 60_000); this.expiryTimer.unref(); }
  onModuleDestroy() { if (this.expiryTimer) clearInterval(this.expiryTimer); }
  private async gate(tenantId: string) { await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory); }
  private async tenantRow(manager: EntityManager, table: string, id: string, tenantId: string) {
    const rows = await manager.query(`SELECT * FROM ${table} WHERE id=$1 AND coffee_shop_id=$2 FOR SHARE`, [id, tenantId]) as Row[];
    if (!rows[0]) throw new NotFoundException("Inventory record not found");
    return rows[0];
  }

  private async scheduledExpirySweep() {
    try {
      const [{ today }] = await this.db.query(`SELECT to_char(clock_timestamp() AT TIME ZONE 'Asia/Tehran','YYYY-MM-DD') AS today`);
      if (today === this.lastExpirySweepDate) return;
      await this.refreshBatchExpiryAlerts();
      this.lastExpirySweepDate = today;
    } catch (error) {
      this.logger.warn(JSON.stringify({ event: "inventory_batch_expiry_sweep_failed" }));
    }
  }

  private async refreshBatchExpiryAlerts(tenantId?: string) {
    await this.db.transaction(async (m) => {
      const values: unknown[] = tenantId ? [tenantId] : [];
      const scope = tenantId ? "AND b.coffee_shop_id=$1" : "";
      const due = await m.query(`SELECT b.coffee_shop_id AS "tenantId",b.id
        FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id
        WHERE b.remaining_quantity_base>0 AND b.expiry_date IS NOT NULL ${scope}
          AND (b.expiry_date<=((clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date+i.expiry_warning_days) OR EXISTS(
            SELECT 1 FROM inventory_stock_alerts a WHERE a.coffee_shop_id=b.coffee_shop_id AND a.batch_id=b.id AND a.status='OPEN'))
        ORDER BY b.coffee_shop_id,b.id`, values);
      for (const row of due) await this.evaluateBatchExpiryAlert(m, row.tenantId, row.id);
      const depleted = await m.query(`SELECT coffee_shop_id AS "tenantId",batch_id AS id FROM inventory_stock_alerts
        WHERE batch_id IS NOT NULL AND status='OPEN' ${tenantId ? "AND coffee_shop_id=$1" : ""} ORDER BY coffee_shop_id,batch_id`, values);
      for (const row of depleted) await this.evaluateBatchExpiryAlert(m, row.tenantId, row.id);
    });
  }

  private async evaluateBatchExpiryAlert(m: EntityManager, tenantId: string, batchId: string) {
    const [batch] = await m.query(`SELECT b.id,b.item_id AS "itemId",b.location_id AS "locationId",b.remaining_quantity_base::text AS remaining,
        b.expiry_date::text AS expiry,i.expiry_warning_days AS "warningDays"
      FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id
      WHERE b.coffee_shop_id=$1 AND b.id=$2 FOR UPDATE OF b`, [tenantId, batchId]);
    if (!batch) return;
    const [{ status }] = await m.query(`SELECT CASE WHEN $1::numeric<=0 OR $2::date IS NULL THEN NULL
        WHEN $2::date<(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date THEN 'BATCH_EXPIRED'
        WHEN $2::date<=((clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date+$3::int) THEN 'BATCH_EXPIRING_SOON'
        ELSE NULL END AS status`, [batch.remaining, batch.expiry, batch.warningDays]);
    const [open] = await m.query(`SELECT id FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND batch_id=$2 AND status='OPEN' FOR UPDATE`, [tenantId, batchId]);
    if (!status) {
      if (open) await m.query(`UPDATE inventory_stock_alerts SET status='RESOLVED',resolved_at=clock_timestamp(),last_observed_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, open.id]);
      return;
    }
    if (open) await m.query(`UPDATE inventory_stock_alerts SET alert_type=$3,last_observed_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, open.id, status]);
    else await m.query(`INSERT INTO inventory_stock_alerts(coffee_shop_id,item_id,location_id,batch_id,alert_type,status,opened_at,last_observed_at)
      VALUES($1,$2,$3,$4,$5,'OPEN',clock_timestamp(),clock_timestamp()) ON CONFLICT(coffee_shop_id,batch_id) WHERE status='OPEN' AND batch_id IS NOT NULL
      DO UPDATE SET alert_type=EXCLUDED.alert_type,last_observed_at=clock_timestamp()`, [tenantId, batch.itemId, batch.locationId, batchId, status]);
  }

  async overview(tenantId: string) {
    await this.gate(tenantId);
    const [summary] = await this.db.query(`SELECT
      (SELECT count(*)::int FROM inventory_items WHERE coffee_shop_id=$1 AND is_active) AS "activeItems",
      (SELECT count(*)::int FROM inventory_stock_balances b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id AND i.is_active WHERE b.coffee_shop_id=$1 AND b.quantity_base<0) AS "negativeBalances",
      (SELECT count(*)::int FROM inventory_stock_balances b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id AND i.is_active WHERE b.coffee_shop_id=$1 AND b.quantity_base=0) AS "outOfStockItems",
      (SELECT count(*)::int FROM inventory_stock_balances b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id AND i.is_active JOIN inventory_stock_rules r ON r.coffee_shop_id=b.coffee_shop_id AND r.item_id=b.item_id AND r.location_id=b.location_id WHERE b.coffee_shop_id=$1 AND b.quantity_base>0 AND r.minimum_quantity_base IS NOT NULL AND b.quantity_base<=r.minimum_quantity_base) AS "lowStockItems",
      (SELECT count(*)::int FROM inventory_stock_balances b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id AND i.is_active JOIN inventory_stock_rules r ON r.coffee_shop_id=b.coffee_shop_id AND r.item_id=b.item_id AND r.location_id=b.location_id WHERE b.coffee_shop_id=$1 AND b.quantity_base>0 AND r.par_quantity_base IS NOT NULL AND b.quantity_base<r.par_quantity_base AND (r.minimum_quantity_base IS NULL OR b.quantity_base>r.minimum_quantity_base)) AS "belowParItems",
      (SELECT count(*)::int FROM inventory_stock_counts WHERE coffee_shop_id=$1 AND status='DRAFT') AS "draftCounts",
      (SELECT count(*)::int FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND type IN ('MANUAL_ADJUSTMENT','STOCK_COUNT_ADJUSTMENT') AND created_at>now()-interval '7 days') AS "recentAdjustments",
      (SELECT count(*)::int FROM inventory_waste_records WHERE coffee_shop_id=$1 AND status='POSTED' AND wasted_at>now()-interval '7 days') AS "recentWasteRecords",
      (SELECT CASE WHEN count(m.total_cost_toman)>0 THEN sum(m.total_cost_toman)::text ELSE NULL END FROM inventory_waste_records w JOIN inventory_waste_items wi ON wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id WHERE w.coffee_shop_id=$1 AND w.status='POSTED' AND w.wasted_at>=date_trunc('month',now())) AS "estimatedWasteCostThisMonth",
      (SELECT count(*)::int FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id WHERE b.coffee_shop_id=$1 AND b.remaining_quantity_base>0 AND b.expiry_date BETWEEN (clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date AND (clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date+i.expiry_warning_days) AS "expiringSoonBatches",
      (SELECT count(*)::int FROM inventory_batches b WHERE b.coffee_shop_id=$1 AND b.remaining_quantity_base>0 AND b.expiry_date<(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date) AS "expiredBatches",
      (SELECT COALESCE(jsonb_agg(jsonb_build_object('unit',expired.base_unit,'quantity',expired.quantity) ORDER BY expired.base_unit),'[]'::jsonb) FROM (
        SELECT i.base_unit,sum(b.remaining_quantity_base)::text AS quantity FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id
        WHERE b.coffee_shop_id=$1 AND b.remaining_quantity_base>0 AND b.expiry_date<(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date GROUP BY i.base_unit
      ) expired) AS "expiredQuantities"`, [tenantId]);
    return summary;
  }

  async categories(tenantId: string) {
    await this.gate(tenantId);
    return this.db.query(`SELECT id,name,"is_active" AS "isActive" FROM inventory_categories WHERE coffee_shop_id=$1 ORDER BY is_active DESC,name`, [tenantId]);
  }
  async createCategory(tenantId: string, input: CreateInventoryCategoryDto) {
    await this.gate(tenantId);
    const [row] = await this.db.query(`INSERT INTO inventory_categories(coffee_shop_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id,name,is_active AS "isActive"`, [tenantId,input.name.trim()]);
    if (!row) throw new ConflictException("Inventory category name already exists");
    return row;
  }
  async updateCategory(tenantId: string, id: string, input: UpdateInventoryCategoryDto) {
    await this.gate(tenantId);
    const rows = await this.db.query(`UPDATE inventory_categories SET name=COALESCE($3,name),is_active=COALESCE($4,is_active),updated_at=now() WHERE coffee_shop_id=$1 AND id=$2 RETURNING id,name,is_active AS "isActive"`, [tenantId,id,input.name?.trim() ?? null,input.isActive ?? null]).catch(uniqueConflict);
    const row=firstRow(rows);if (!row) throw new NotFoundException("Inventory category not found");
    return row;
  }

  async locations(tenantId: string) {
    await this.gate(tenantId);
    await this.defaultLocation(this.db.manager, tenantId);
    return this.db.query(`SELECT id,name,is_default AS "isDefault",is_active AS "isActive" FROM inventory_locations WHERE coffee_shop_id=$1 ORDER BY is_default DESC,name`, [tenantId]);
  }
  async createLocation(tenantId: string, input: CreateInventoryLocationDto) {
    await this.gate(tenantId);
    return this.db.transaction(async (m) => {
      await m.query(`SELECT id FROM coffee_shops WHERE id=$1 FOR UPDATE`,[tenantId]);
      const [existing] = await m.query(`SELECT id FROM inventory_locations WHERE coffee_shop_id=$1 AND is_default`,[tenantId]);
      const isDefault=input.isDefault ?? !existing;
      if (isDefault) await m.query(`UPDATE inventory_locations SET is_default=false WHERE coffee_shop_id=$1 AND is_default`, [tenantId]);
      const [row] = await m.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default) VALUES($1,$2,$3) RETURNING id,name,is_default AS "isDefault",is_active AS "isActive"`, [tenantId,input.name.trim(),isDefault]);
      return row;
    }).catch(uniqueConflict);
  }
  async updateLocation(tenantId: string, id: string, input: UpdateInventoryLocationDto) {
    await this.gate(tenantId);
    return this.db.transaction(async (m) => {
      await m.query(`SELECT id FROM coffee_shops WHERE id=$1 FOR UPDATE`,[tenantId]);
      await this.tenantRow(m,"inventory_locations",id,tenantId);
      if (input.isDefault) await m.query(`UPDATE inventory_locations SET is_default=false WHERE coffee_shop_id=$1 AND id<>$2 AND is_default`, [tenantId,id]);
      const [row] = await m.query(`UPDATE inventory_locations SET name=COALESCE($3,name),is_default=COALESCE($4,is_default),is_active=COALESCE($5,is_active),updated_at=now() WHERE coffee_shop_id=$1 AND id=$2 RETURNING id,name,is_default AS "isDefault",is_active AS "isActive"`,[tenantId,id,input.name?.trim() ?? null,input.isDefault ?? null,input.isActive ?? null]);
      if (input.isActive === false && row.isDefault) throw new ConflictException("Choose another default location before deactivating this one");
      return row;
    }).catch(uniqueConflict);
  }

  async items(tenantId: string, query: InventoryListQueryDto) {
    await this.gate(tenantId);
    const page = query.page ?? 1, limit = query.limit ?? 50;
    const where = ["i.coffee_shop_id=$1"];
    const values: unknown[] = [tenantId];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replaceAll("?", `$${values.length}`)); };
    if (query.search?.trim()) add("(i.name ILIKE '%'||?||'%' OR i.sku ILIKE '%'||?||'%')",query.search.trim());
    if (query.categoryId) add("i.category_id=?",query.categoryId);
    if (query.active) add("i.is_active=?",query.active === "true");
    const countValues = [...values];
    values.push(limit,(page-1)*limit);
    const rows = await this.db.query(`SELECT i.id,i.name,i.sku,i.description,i.dimension,i.base_unit AS "baseUnit",i.category_id AS "categoryId",c.name AS "categoryName",i.is_active AS "isActive",i.batch_tracking_enabled AS "batchTrackingEnabled",i.expiry_tracking_enabled AS "expiryTrackingEnabled",i.expiry_warning_days AS "expiryWarningDays",i.created_at AS "createdAt",i.updated_at AS "updatedAt" FROM inventory_items i LEFT JOIN inventory_categories c ON c.id=i.category_id AND c.coffee_shop_id=i.coffee_shop_id WHERE ${where.join(" AND ")} ORDER BY i.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{ count }] = await this.db.query(`SELECT count(*)::int AS count FROM inventory_items i WHERE ${where.join(" AND ")}`,countValues);
    return { items: rows, page, limit, total: count };
  }

  private batchStatusSql(batch = "b", item = "i") {
    return `CASE WHEN ${batch}.remaining_quantity_base<=0 THEN 'DEPLETED' WHEN ${batch}.expiry_date IS NULL THEN 'NO_EXPIRY' WHEN ${batch}.expiry_date<(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date THEN 'EXPIRED' WHEN ${batch}.expiry_date<=((clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date+${item}.expiry_warning_days) THEN 'EXPIRING_SOON' ELSE 'ACTIVE' END`;
  }

  async batches(tenantId: string, query: InventoryBatchListQueryDto) {
    await this.gate(tenantId);
    await this.refreshBatchExpiryAlerts(tenantId);
    const status = this.batchStatusSql();
    const values: unknown[] = [tenantId], where = ["b.coffee_shop_id=$1"];
    const add = (sql: string, value: unknown) => { values.push(value); where.push(sql.replace("?", `$${values.length}`)); };
    if (query.itemId) add("b.item_id=?", query.itemId);
    if (query.locationId) add("b.location_id=?", query.locationId);
    if (query.supplierId) add("r.supplier_id=?", query.supplierId);
    if (query.search?.trim()) { values.push(query.search.trim()); where.push(`(i.name ILIKE '%'||$${values.length}||'%' OR COALESCE(b.supplier_lot_number,'') ILIKE '%'||$${values.length}||'%' OR COALESCE(r.number,'') ILIKE '%'||$${values.length}||'%')`); }
    if (query.status && query.status !== "ALL") add(`${status}=?`, query.status);
    else if (!query.status) where.push("b.remaining_quantity_base>0");
    const from = `FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id JOIN inventory_locations l ON l.coffee_shop_id=b.coffee_shop_id AND l.id=b.location_id LEFT JOIN inventory_goods_receipts r ON r.coffee_shop_id=b.coffee_shop_id AND r.id=b.goods_receipt_id LEFT JOIN inventory_suppliers s ON s.coffee_shop_id=r.coffee_shop_id AND s.id=r.supplier_id`;
    const countValues = [...values], page = query.page ?? 1, limit = query.limit ?? 50;
    values.push(limit, (page - 1) * limit);
    const items = await this.db.query(`SELECT b.id,b.id AS "batchId",COALESCE(NULLIF(b.supplier_lot_number,''),'BATCH-'||upper(left(b.id::text,8))) AS "batchNumber",b.supplier_lot_number AS "supplierLotNumber",b.item_id AS "itemId",i.name AS "itemName",i.dimension,i.base_unit AS "baseUnit",b.location_id AS "locationId",l.name AS "locationName",b.received_at AS "receivedAt",b.manufactured_date::text AS "manufacturedDate",b.expiry_date::text AS "expiryDate",b.original_quantity_base::text AS "originalQuantityBase",b.remaining_quantity_base::text AS "remainingQuantityBase",b.unit_cost_toman::text AS "unitCostToman",b.total_cost_toman AS "totalCostToman",b.origin_type AS "originType",b.goods_receipt_id AS "goodsReceiptId",r.number AS "goodsReceiptNumber",s.id AS "supplierId",s.name AS "supplierName",${status} AS status,((b.expiry_date-(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date))::int AS "daysUntilExpiry" ${from} WHERE ${where.join(" AND ")} ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END,b.expiry_date,b.received_at,b.created_at,b.id LIMIT $${values.length-1} OFFSET $${values.length}`, values);
    const [{ count }] = await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`, countValues);
    return { items: items.map((row: Record<string, string | null>) => { const unit = row.baseUnit!; const dimension = row.dimension as InventoryDimension; return { ...row, remainingQuantity: quantityFromBase(row.remainingQuantityBase!, dimension, unit, unit), originalQuantity: quantityFromBase(row.originalQuantityBase!, dimension, unit, unit) }; }), page, limit, total: count };
  }

  async batch(tenantId: string, id: string) {
    await this.gate(tenantId);
    await this.refreshBatchExpiryAlerts(tenantId);
    const status = this.batchStatusSql();
    const [batch] = await this.db.query(`SELECT b.id,COALESCE(NULLIF(b.supplier_lot_number,''),'BATCH-'||upper(left(b.id::text,8))) AS "batchNumber",b.supplier_lot_number AS "supplierLotNumber",b.item_id AS "itemId",i.name AS "itemName",i.dimension,i.base_unit AS "baseUnit",b.location_id AS "locationId",l.name AS "locationName",b.received_at AS "receivedAt",b.manufactured_date::text AS "manufacturedDate",b.expiry_date::text AS "expiryDate",b.original_quantity_base::text AS "originalQuantityBase",b.remaining_quantity_base::text AS "remainingQuantityBase",b.unit_cost_toman::text AS "unitCostToman",b.total_cost_toman AS "totalCostToman",b.origin_type AS "originType",b.goods_receipt_id AS "goodsReceiptId",r.number AS "goodsReceiptNumber",r.purchase_order_id AS "purchaseOrderId",po.number AS "purchaseOrderNumber",s.id AS "supplierId",s.name AS "supplierName",${status} AS status
      FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id JOIN inventory_locations l ON l.coffee_shop_id=b.coffee_shop_id AND l.id=b.location_id LEFT JOIN inventory_goods_receipts r ON r.coffee_shop_id=b.coffee_shop_id AND r.id=b.goods_receipt_id LEFT JOIN inventory_purchase_orders po ON po.coffee_shop_id=r.coffee_shop_id AND po.id=r.purchase_order_id LEFT JOIN inventory_suppliers s ON s.coffee_shop_id=r.coffee_shop_id AND s.id=r.supplier_id WHERE b.coffee_shop_id=$1 AND b.id=$2`, [tenantId, id]);
    if (!batch) throw new NotFoundException("Inventory batch not found");
    batch.movements = await this.db.query(`SELECT m.id,m.type,m.quantity_base::text AS "quantityBase",m.reason,m.source_type AS "sourceType",m.source_id AS "sourceId",m.source_line_id AS "sourceLineId",m.reversal_of_movement_id AS "reversalOfMovementId",m.created_at AS "createdAt" FROM inventory_stock_movements m WHERE m.coffee_shop_id=$1 AND m.batch_id=$2 ORDER BY m.created_at,m.id`, [tenantId, id]);
    batch.changes = await this.db.query(`SELECT id,actor_user_id AS "actorUserId",reason,old_supplier_lot_number AS "oldSupplierLotNumber",new_supplier_lot_number AS "newSupplierLotNumber",old_manufactured_date::text AS "oldManufacturedDate",new_manufactured_date::text AS "newManufacturedDate",old_expiry_date::text AS "oldExpiryDate",new_expiry_date::text AS "newExpiryDate",created_at AS "createdAt" FROM inventory_batch_changes WHERE coffee_shop_id=$1 AND batch_id=$2 ORDER BY created_at DESC,id DESC`, [tenantId, id]);
    batch.originalQuantity = quantityFromBase(batch.originalQuantityBase, batch.dimension as InventoryDimension, batch.baseUnit, batch.baseUnit);
    batch.remainingQuantity = quantityFromBase(batch.remainingQuantityBase, batch.dimension as InventoryDimension, batch.baseUnit, batch.baseUnit);
    return batch;
  }

  async itemBatches(tenantId: string, itemId: string, locationId?: string) {
    await this.gate(tenantId);
    const [item] = await this.db.query(`SELECT id,name,dimension,base_unit AS "baseUnit",batch_tracking_enabled AS "batchTrackingEnabled" FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, itemId]);
    if (!item) throw new NotFoundException("Inventory item not found");
    const selectedLocationId = locationId ?? (await this.defaultLocation(this.db.manager, tenantId)).id;
    await this.activeLocation(this.db.manager, tenantId, selectedLocationId);
    const [balance] = await this.db.query(`SELECT quantity_base::text AS quantity FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, itemId, selectedLocationId]);
    const rows = await this.db.query(`SELECT b.id,COALESCE(NULLIF(b.supplier_lot_number,''),'BATCH-'||upper(left(b.id::text,8))) AS "batchNumber",b.supplier_lot_number AS "supplierLotNumber",b.expiry_date::text AS "expiryDate",b.received_at AS "receivedAt",b.original_quantity_base::text AS "originalQuantityBase",b.remaining_quantity_base::text AS "remainingQuantityBase",${this.batchStatusSql()} AS status FROM inventory_batches b JOIN inventory_items i ON i.coffee_shop_id=b.coffee_shop_id AND i.id=b.item_id WHERE b.coffee_shop_id=$1 AND b.item_id=$2 AND b.location_id=$3 ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END,b.expiry_date,b.received_at,b.created_at,b.id`, [tenantId, itemId, selectedLocationId]);
    const [batchTotal] = await this.db.query(`SELECT COALESCE(sum(remaining_quantity_base),0)::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, itemId, selectedLocationId]);
    const total = balance?.quantity ?? "0", unallocated = addQuantities(total, `-${batchTotal.quantity}`), unit = item.baseUnit;
    return { item, locationId: selectedLocationId, quantityBase: total, unallocatedQuantityBase: unallocated, quantity: quantityFromBase(total, item.dimension, unit, unit), unallocatedQuantity: quantityFromBase(unallocated, item.dimension, unit, unit), batches: rows };
  }

  async updateBatch(tenantId: string, actorId: string, id: string, input: UpdateInventoryBatchDto) {
    await this.gate(tenantId);
    this.assertDatePair(input.manufacturedDate, input.expiryDate);
    await this.db.transaction(async (m) => {
      const [batch] = await m.query(`SELECT supplier_lot_number AS "supplierLotNumber",manufactured_date::text AS "manufacturedDate",expiry_date::text AS "expiryDate" FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
      if (!batch) throw new NotFoundException("Inventory batch not found");
      const next = {
        supplierLotNumber: input.supplierLotNumber === undefined ? batch.supplierLotNumber : input.supplierLotNumber?.trim() || null,
        manufacturedDate: input.manufacturedDate === undefined ? batch.manufacturedDate : input.manufacturedDate,
        expiryDate: input.expiryDate === undefined ? batch.expiryDate : input.expiryDate,
      };
      this.assertDatePair(next.manufacturedDate, next.expiryDate);
      if (next.supplierLotNumber === batch.supplierLotNumber && next.manufacturedDate === batch.manufacturedDate && next.expiryDate === batch.expiryDate) return;
      await m.query(`INSERT INTO inventory_batch_changes(coffee_shop_id,batch_id,actor_user_id,reason,old_supplier_lot_number,new_supplier_lot_number,old_manufactured_date,new_manufactured_date,old_expiry_date,new_expiry_date)
        VALUES($1,$2,$3,$4,$5,$6,$7::date,$8::date,$9::date,$10::date)`, [tenantId, id, actorId, input.reason.trim(), batch.supplierLotNumber, next.supplierLotNumber, batch.manufacturedDate, next.manufacturedDate, batch.expiryDate, next.expiryDate]);
      await m.query(`UPDATE inventory_batches SET supplier_lot_number=$3,manufactured_date=$4::date,expiry_date=$5::date,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, id, next.supplierLotNumber, next.manufacturedDate, next.expiryDate]);
      await this.evaluateBatchExpiryAlert(m, tenantId, id);
    });
    return this.batch(tenantId, id);
  }

  private assertDatePair(manufacturedDate?: string | null, expiryDate?: string | null) {
    for (const value of [manufacturedDate, expiryDate]) if (value) { const date = new Date(`${value}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException("Batch dates must be valid ISO calendar dates"); }
    if (manufacturedDate && expiryDate && expiryDate < manufacturedDate) throw new BadRequestException("Expiry date cannot be before manufacture date");
  }

  private async insertBatch(m: EntityManager, tenantId: string, input: { itemId:string; locationId:string; quantity:string; originType:string; supplierLotNumber?:string|null; manufacturedDate?:string|null; expiryDate?:string|null; actorId:string|null; receiptId?:string|null; receiptLineId?:string|null; unitCostToman?:string|null; totalCostToman?:string|null; receivedAt?:string|null }) {
    const [batch] = await m.query(`INSERT INTO inventory_batches(coffee_shop_id,item_id,location_id,supplier_lot_number,manufactured_date,expiry_date,received_at,original_quantity_base,unit_cost_toman,total_cost_toman,origin_type,goods_receipt_id,goods_receipt_line_id,created_by_user_id)
      VALUES($1,$2,$3,$4,$5::date,$6::date,COALESCE($7::timestamptz,clock_timestamp()),$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [tenantId,input.itemId,input.locationId,input.supplierLotNumber??null,input.manufacturedDate??null,input.expiryDate??null,input.receivedAt??null,input.quantity,input.unitCostToman??null,input.totalCostToman??null,input.originType,input.receiptId??null,input.receiptLineId??null,input.actorId]);
    return batch.id as string;
  }

  private async lockBalance(m: EntityManager, tenantId: string, itemId: string, locationId: string) {
    await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId,itemId,locationId]);
    const [balance] = await m.query(`SELECT quantity_base::text AS quantity FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`, [tenantId,itemId,locationId]);
    return balance;
  }

  private async postFefoDecrease(m: EntityManager, tenantId: string, actorId: string, operation: Omit<MovementOperation,"quantity"|"batchId"> & { quantity:string }, includeExpired: boolean) {
    const required = operation.quantity.startsWith("-") ? operation.quantity.slice(1) : operation.quantity;
    if (compareQuantities(required,"0")<=0) throw new BadRequestException("Batch allocation quantity must be positive");
    const replay = async () => {
      const prior = await m.query(`SELECT id,item_id,location_id,type,quantity_base::text AS quantity,reason,source_type,source_id,order_item_id,recipe_version_id,recipe_component_id
        FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND left(idempotency_key,length($2)+7)=$2||':batch:'`,[tenantId,operation.idempotencyKey]);
      if(!prior.length)return null;
      const valid=prior.every((row:Record<string,string|null>)=>row.item_id===operation.itemId&&row.location_id===operation.locationId&&row.type===operation.type&&String(row.quantity).startsWith("-")&&row.reason===operation.reason&&row.source_type===operation.sourceType&&row.source_id===operation.sourceId&&row.order_item_id===(operation.orderItemId??null)&&row.recipe_version_id===(operation.recipeVersionId??null)&&row.recipe_component_id===(operation.recipeComponentId??null));
      const total=prior.reduce((sum:string,row:Record<string,string|null>)=>addQuantities(sum,String(row.quantity)),"0");
      if(!valid||compareQuantities(total,`-${required}`)!==0)throw new ConflictException("Idempotency key was already used for a different stock operation");
      const [balance]=await m.query(`SELECT quantity_base::text AS quantity FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,operation.itemId,operation.locationId]);
      return {id:prior[0]!.id,balance:balance?.quantity??"0",duplicate:true};
    };
    const prior=await replay();if(prior)return prior;
    await this.lockBalance(m,tenantId,operation.itemId,operation.locationId);
    const afterLock=await replay();if(afterLock)return afterLock;
    const eligible = await m.query(`SELECT b.id,b.remaining_quantity_base::text AS remaining FROM inventory_batches b
      WHERE b.coffee_shop_id=$1 AND b.item_id=$2 AND b.location_id=$3 AND b.remaining_quantity_base>0
        AND ($4::boolean OR b.expiry_date IS NULL OR b.expiry_date>=(clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date)
      ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END,b.expiry_date,b.received_at,b.created_at,b.id FOR UPDATE OF b`, [tenantId,operation.itemId,operation.locationId,includeExpired]);
    let remaining = required;
    let result: { id:string; balance:string; duplicate:boolean } | undefined;
    for (const batch of eligible) {
      if (remaining === "0") break;
      const take = compareQuantities(batch.remaining,remaining) < 0 ? batch.remaining : remaining;
      const movement=await this.postMovement(m,tenantId,actorId,{...operation,batchId:batch.id,sourceLineId:operation.sourceLineId?`${operation.sourceLineId}:${batch.id}`:null,quantity:`-${take}`,idempotencyKey:`${operation.idempotencyKey}:batch:${batch.id}`});
      result??=movement;
      result={...movement,id:result.id};
      remaining = addQuantities(remaining,`-${take}`);
    }
    if (remaining !== "0") { const movement=await this.postMovement(m,tenantId,actorId,{...operation,batchId:null,quantity:`-${remaining}`,idempotencyKey:`${operation.idempotencyKey}:batch:unallocated`}); result??=movement; result={...movement,id:result.id}; }
    return result!;
  }
  async stock(tenantId: string, query: InventoryListQueryDto) {
    await this.gate(tenantId);
    const status = `CASE WHEN b.id IS NULL AND r.id IS NULL THEN NULL WHEN COALESCE(b.quantity_base,0)<0 THEN 'NEGATIVE' WHEN COALESCE(b.quantity_base,0)=0 THEN 'OUT_OF_STOCK' WHEN r.minimum_quantity_base IS NOT NULL AND b.quantity_base<=r.minimum_quantity_base THEN 'LOW_STOCK' WHEN r.par_quantity_base IS NOT NULL AND b.quantity_base<r.par_quantity_base THEN 'BELOW_PAR' ELSE 'OK' END`;
    const from = `FROM inventory_items i JOIN inventory_locations l ON l.coffee_shop_id=i.coffee_shop_id AND l.is_active LEFT JOIN inventory_categories c ON c.coffee_shop_id=i.coffee_shop_id AND c.id=i.category_id LEFT JOIN inventory_stock_balances b ON b.coffee_shop_id=i.coffee_shop_id AND b.item_id=i.id AND b.location_id=l.id LEFT JOIN inventory_stock_rules r ON r.coffee_shop_id=i.coffee_shop_id AND r.item_id=i.id AND r.location_id=l.id LEFT JOIN LATERAL (SELECT sum(greatest(oi.quantity_base-COALESCE((SELECT sum(rl.quantity_base) FROM inventory_goods_receipt_lines rl JOIN inventory_goods_receipts gr ON gr.coffee_shop_id=rl.coffee_shop_id AND gr.id=rl.goods_receipt_id AND gr.status='POSTED' WHERE rl.coffee_shop_id=oi.coffee_shop_id AND rl.purchase_order_item_id=oi.id),0),0)) AS quantity_base FROM inventory_purchase_order_items oi JOIN inventory_purchase_orders po ON po.coffee_shop_id=oi.coffee_shop_id AND po.id=oi.purchase_order_id AND po.status IN ('ORDERED','PARTIALLY_RECEIVED') WHERE oi.coffee_shop_id=i.coffee_shop_id AND oi.inventory_item_id=i.id AND oi.location_id=l.id) on_order ON true`;
    const where = ["i.coffee_shop_id=$1"];
    const values: unknown[]=[tenantId];
    const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replaceAll("?",`$${values.length}`));};
    if (query.active) add("i.is_active=?",query.active === "true");
    if (query.search?.trim()) add("(i.name ILIKE '%'||?||'%' OR i.sku ILIKE '%'||?||'%')",query.search.trim());
    if (query.categoryId) add("i.category_id=?",query.categoryId);
    if (query.itemId) add("i.id=?",query.itemId);
    if (query.locationId) add("l.id=?",query.locationId);
    if (query.stockStatus) add(`${status}=?`,query.stockStatus);
    const page=query.page??1,limit=query.limit??50,countValues=[...values];values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT i.id AS "itemId",i.name,i.sku,i.dimension,i.base_unit AS "baseUnit",i.is_active AS "isActive",i.batch_tracking_enabled AS "batchTrackingEnabled",i.expiry_tracking_enabled AS "expiryTrackingEnabled",c.name AS "categoryName",l.id AS "locationId",l.name AS "locationName",l.is_default AS "isDefault",COALESCE(b.quantity_base,0)::text AS "quantityBase",(SELECT COALESCE(sum(bb.remaining_quantity_base),0) FROM inventory_batches bb WHERE bb.coffee_shop_id=i.coffee_shop_id AND bb.item_id=i.id AND bb.location_id=l.id)::text AS "batchQuantityBase",(COALESCE(b.quantity_base,0)-(SELECT COALESCE(sum(bb.remaining_quantity_base),0) FROM inventory_batches bb WHERE bb.coffee_shop_id=i.coffee_shop_id AND bb.item_id=i.id AND bb.location_id=l.id))::text AS "unallocatedQuantityBase",b.average_unit_cost_toman::text AS "averageUnitCostToman",r.minimum_quantity_base::text AS "minimumQuantityBase",r.par_quantity_base::text AS "parQuantityBase",r.display_unit AS "thresholdUnit",${status} AS "stockStatus",
      COALESCE(on_order.quantity_base,0)::text AS "onOrderQuantityBase",(COALESCE(b.quantity_base,0)+COALESCE(on_order.quantity_base,0))::text AS "projectedQuantityBase",
      CASE WHEN r.par_quantity_base IS NULL THEN NULL ELSE greatest(r.par_quantity_base-COALESCE(b.quantity_base,0),0)::text END AS "parGapBase",
      CASE WHEN r.par_quantity_base IS NULL THEN NULL ELSE greatest(r.par_quantity_base-(COALESCE(b.quantity_base,0)+COALESCE(on_order.quantity_base,0)),0)::text END AS "projectedParGapBase",
      (SELECT max(m.created_at) FROM inventory_stock_movements m WHERE m.coffee_shop_id=i.coffee_shop_id AND m.item_id=i.id AND m.location_id=l.id) AS "lastMovementAt" ${from} WHERE ${where.join(" AND ")} ORDER BY i.is_active DESC,i.name,l.is_default DESC,l.name LIMIT $${values.length-1} OFFSET $${values.length}`, values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`,countValues);
    const items=rows.map((row:Record<string,string|null>)=>{
      const baseUnit=row.baseUnit!,dimension=row.dimension as InventoryDimension,unit=row.thresholdUnit??baseUnit;
      const display=(value:string|null|undefined)=>value==null?null:quantityFromBase(value,dimension,unit,baseUnit);
      return {...row,unit,quantity:display(row.quantityBase)!,batchQuantity:display(row.batchQuantityBase)!,unallocatedQuantity:display(row.unallocatedQuantityBase)!,minimumQuantity:display(row.minimumQuantityBase),parQuantity:display(row.parQuantityBase),onOrderQuantity:display(row.onOrderQuantityBase)!,projectedQuantity:display(row.projectedQuantityBase)!,parGap:display(row.parGapBase),projectedParGap:display(row.projectedParGapBase)};
    });
    return {items,page,limit,total:count};
  }

  async updateStockSettings(tenantId: string, itemId: string, input: InventoryStockSettingsDto) {
    await this.gate(tenantId);
    await this.db.transaction(async (m) => {
      const item = await this.tenantRow(m, "inventory_items", itemId, tenantId);
      await this.activeLocation(m, tenantId, input.locationId);
      await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`, [tenantId, itemId, input.locationId]);
      const [balance] = await m.query(`SELECT id FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`, [tenantId, itemId, input.locationId]);
      const [current] = await m.query(`SELECT minimum_quantity_base::text AS "minimumQuantityBase",par_quantity_base::text AS "parQuantityBase",display_unit AS "displayUnit" FROM inventory_stock_rules WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`, [tenantId, itemId, input.locationId]);
      const unit = input.unit ?? current?.displayUnit ?? item.base_unit;
      const minimum = input.minimumQuantity === undefined ? current?.minimumQuantityBase ?? null : input.minimumQuantity === null ? null : quantityToBase(input.minimumQuantity, item.dimension, unit, item.base_unit);
      const par = input.parQuantity === undefined ? current?.parQuantityBase ?? null : input.parQuantity === null ? null : quantityToBase(input.parQuantity, item.dimension, unit, item.base_unit);
      if (minimum !== null && compareQuantities(minimum, "0") < 0 || par !== null && compareQuantities(par, "0") < 0) throw new BadRequestException("Stock thresholds cannot be negative");
      if (minimum !== null && par !== null && compareQuantities(par, minimum) < 0) throw new BadRequestException("Target stock must be greater than or equal to minimum stock");
      if (minimum === null && par === null) {
        await m.query(`DELETE FROM inventory_stock_rules WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, itemId, input.locationId]);
      } else {
        await m.query(`INSERT INTO inventory_stock_rules(coffee_shop_id,item_id,location_id,minimum_quantity_base,par_quantity_base,display_unit)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(coffee_shop_id,item_id,location_id) DO UPDATE SET minimum_quantity_base=EXCLUDED.minimum_quantity_base,par_quantity_base=EXCLUDED.par_quantity_base,display_unit=EXCLUDED.display_unit,updated_at=clock_timestamp()`,
        [tenantId, itemId, input.locationId, minimum, par, unit]);
      }
      await this.evaluateStockAlert(m, tenantId, itemId, input.locationId);
      if (!balance) throw new ConflictException("Stock row could not be initialized");
    });
    const [result] = await this.db.query(`SELECT r.minimum_quantity_base::text AS "minimumQuantityBase",r.par_quantity_base::text AS "parQuantityBase",r.display_unit AS unit
      FROM inventory_stock_rules r WHERE r.coffee_shop_id=$1 AND r.item_id=$2 AND r.location_id=$3`, [tenantId, itemId, input.locationId]);
    return result ?? { minimumQuantityBase: null, parQuantityBase: null, unit: null };
  }

  async stockAlerts(tenantId: string, query: StockAlertListQueryDto) {
    await this.gate(tenantId);
    await this.refreshBatchExpiryAlerts(tenantId);
    const page=query.page??1,limit=query.limit??50,values:unknown[]=[tenantId],where=["a.coffee_shop_id=$1"];
    if (query.status && query.status !== "ALL") { values.push(query.status); where.push(`a.status=$${values.length}`); }
    if (query.itemId) { values.push(query.itemId); where.push(`a.item_id=$${values.length}`); }
    if (query.locationId) { values.push(query.locationId); where.push(`a.location_id=$${values.length}`); }
    if (query.type) { values.push(query.type); where.push(`a.alert_type=$${values.length}`); }
    const from=`FROM inventory_stock_alerts a JOIN inventory_items i ON i.coffee_shop_id=a.coffee_shop_id AND i.id=a.item_id JOIN inventory_locations l ON l.coffee_shop_id=a.coffee_shop_id AND l.id=a.location_id LEFT JOIN inventory_stock_balances b ON b.coffee_shop_id=a.coffee_shop_id AND b.item_id=a.item_id AND b.location_id=a.location_id LEFT JOIN inventory_stock_rules r ON r.coffee_shop_id=a.coffee_shop_id AND r.item_id=a.item_id AND r.location_id=a.location_id LEFT JOIN inventory_batches bt ON bt.coffee_shop_id=a.coffee_shop_id AND bt.id=a.batch_id`;
    const countValues=[...values];values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT a.id,a.item_id AS "itemId",i.name AS "itemName",i.dimension,i.base_unit AS "baseUnit",r.display_unit AS "displayUnit",a.location_id AS "locationId",l.name AS "locationName",a.batch_id AS "batchId",COALESCE(NULLIF(bt.supplier_lot_number,''),'BATCH-'||upper(left(bt.id::text,8))) AS "batchNumber",bt.expiry_date::text AS "expiryDate",bt.remaining_quantity_base::text AS "batchRemainingQuantityBase",a.alert_type AS type,a.status,a.opened_at AS "openedAt",a.last_observed_at AS "lastObservedAt",a.resolved_at AS "resolvedAt",COALESCE(b.quantity_base,0)::text AS "quantityBase",r.minimum_quantity_base::text AS "minimumQuantityBase",r.par_quantity_base::text AS "parQuantityBase" ${from} WHERE ${where.join(" AND ")} ORDER BY (a.status='OPEN') DESC,a.opened_at DESC,a.id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`,countValues);
    const items=rows.map((row:Record<string,string|null>)=>{const baseUnit=row.baseUnit!,dimension=row.dimension as InventoryDimension,unit=row.displayUnit??baseUnit;const display=(value:string|null|undefined)=>value==null?null:quantityFromBase(value,dimension,unit,baseUnit);return {...row,unit,quantity:display(row.quantityBase)!,batchRemainingQuantity:display(row.batchRemainingQuantityBase),minimumQuantity:display(row.minimumQuantityBase),parQuantity:display(row.parQuantityBase)};});
    return {items,page,limit,total:count};
  }

  async wasteRecords(tenantId: string, query: WasteListQueryDto) {
    await this.gate(tenantId);
    if(query.from&&query.to&&query.from>query.to)throw new BadRequestException("Start date must be before end date");
    const page=query.page??1,limit=query.limit??50,values:unknown[]=[tenantId],where=["w.coffee_shop_id=$1"];
    const add=(sql:string,value:unknown)=>{values.push(value);where.push(sql.replaceAll("?",`$${values.length}`));};
    if(query.status)add("w.status=?",query.status);
    if(query.reason)add("w.reason=?",query.reason);
    if(query.locationId)add("w.location_id=?",query.locationId);
    if(query.itemId)add("EXISTS(SELECT 1 FROM inventory_waste_items wi WHERE wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id AND wi.item_id=?)",query.itemId);
    if(query.from)add("w.wasted_at>=?::date",query.from);
    if(query.to)add("w.wasted_at<?::date+interval '1 day'",query.to);
    if(query.search?.trim())add("(w.note ILIKE '%'||?||'%' OR EXISTS(SELECT 1 FROM inventory_waste_items wi WHERE wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id AND wi.item_name_snapshot ILIKE '%'||?||'%'))",query.search.trim());
    const from=`FROM inventory_waste_records w JOIN inventory_locations l ON l.coffee_shop_id=w.coffee_shop_id AND l.id=w.location_id`;
    const countValues=[...values];values.push(limit,(page-1)*limit);
    const items=await this.db.query(`SELECT w.id,w.location_id AS "locationId",l.name AS "locationName",w.wasted_at AS "wastedAt",w.reason,w.note,w.status,w.created_by_user_id AS "createdByUserId",w.posted_by_user_id AS "postedByUserId",w.posted_at AS "postedAt",w.reversed_by_user_id AS "reversedByUserId",w.reversed_at AS "reversedAt",w.created_at AS "createdAt",
      (SELECT count(*)::int FROM inventory_waste_items wi WHERE wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id) AS "itemCount",
      (SELECT CASE WHEN count(m.total_cost_toman)>0 THEN sum(m.total_cost_toman)::text ELSE NULL END FROM inventory_waste_items wi JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id WHERE wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id) AS "estimatedCostToman",
      (SELECT count(*)::int FROM inventory_waste_items wi WHERE wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id AND wi.movement_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM inventory_stock_movements m WHERE m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id AND m.total_cost_toman IS NOT NULL)) AS "unknownCostItemCount"
      ${from} WHERE ${where.join(" AND ")} ORDER BY w.wasted_at DESC,w.id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`,countValues);
    return {items,page,limit,total:count};
  }

  async wasteRecord(tenantId: string, id: string) {
    await this.gate(tenantId);
    const [record]=await this.db.query(`SELECT w.id,w.location_id AS "locationId",l.name AS "locationName",w.wasted_at AS "wastedAt",w.reason,w.note,w.status,w.created_by_user_id AS "createdByUserId",w.posted_by_user_id AS "postedByUserId",w.posted_at AS "postedAt",w.reversed_by_user_id AS "reversedByUserId",w.reversed_at AS "reversedAt",w.created_at AS "createdAt"
      FROM inventory_waste_records w JOIN inventory_locations l ON l.coffee_shop_id=w.coffee_shop_id AND l.id=w.location_id WHERE w.coffee_shop_id=$1 AND w.id=$2`,[tenantId,id]);
    if(!record)throw new NotFoundException("Waste record not found");
    record.items=await this.db.query(`SELECT wi.id,wi.item_id AS "itemId",wi.item_name_snapshot AS "itemName",wi.batch_id AS "batchId",COALESCE(NULLIF(bt.supplier_lot_number,''),'BATCH-'||upper(left(bt.id::text,8))) AS "batchNumber",i.dimension,i.base_unit AS "baseUnit",wi.quantity_display::text AS quantity,wi.unit,wi.quantity_base::text AS "quantityBase",wi.movement_id AS "movementId",m.unit_cost_toman::text AS "unitCostToman",m.total_cost_toman AS "totalCostToman"
      FROM inventory_waste_items wi JOIN inventory_items i ON i.coffee_shop_id=wi.coffee_shop_id AND i.id=wi.item_id LEFT JOIN inventory_batches bt ON bt.coffee_shop_id=wi.coffee_shop_id AND bt.id=wi.batch_id LEFT JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id
      WHERE wi.coffee_shop_id=$1 AND wi.waste_record_id=$2 ORDER BY wi.created_at,wi.id`,[tenantId,id]);
    const costs=record.items.filter((line:Record<string,unknown>)=>line.totalCostToman!==null&&line.totalCostToman!==undefined).map((line:Record<string,string>)=>line.totalCostToman);
    record.estimatedCostToman=costs.length?costs.reduce((sum:string,value:string)=>addQuantities(sum,value),"0"):null;
    record.unknownCostItemCount=record.items.filter((line:Record<string,unknown>)=>line.movementId&&line.totalCostToman==null).length;
    return record;
  }

  async createWasteRecord(tenantId: string, actorId: string, input: CreateWasteRecordDto) {
    await this.gate(tenantId);
    const id=await this.db.transaction(async(m)=>{
      await this.activeLocation(m,tenantId,input.locationId);
      const items=await this.normalizeWasteItems(m,tenantId,input.locationId,input.items);
      const wastedAt=this.wasteDate(input.wastedAt);
      const [record]=await m.query(`INSERT INTO inventory_waste_records(coffee_shop_id,location_id,wasted_at,reason,note,created_by_user_id) VALUES($1,$2,COALESCE($3::timestamptz,clock_timestamp()),$4,$5,$6) RETURNING id`,[tenantId,input.locationId,wastedAt,input.reason,input.note?.trim()||null,actorId]);
      for(const line of items)await m.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,batch_id,item_name_snapshot,quantity_display,unit,quantity_base) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantId,record.id,line.item.id,line.batchId,line.item.name,line.quantity,line.unit,line.quantityBase]);
      return record.id as string;
    });
    return this.wasteRecord(tenantId,id);
  }

  async updateWasteRecord(tenantId: string, id: string, input: UpdateWasteRecordDto) {
    await this.gate(tenantId);
    await this.db.transaction(async(m)=>{
      const [record]=await m.query(`SELECT * FROM inventory_waste_records WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!record)throw new NotFoundException("Waste record not found");
      if(record.status!==InventoryWasteStatus.Draft)throw new ConflictException("Posted waste records cannot be edited; reverse and create a corrected record");
      const locationId=input.locationId??record.location_id;
      if(input.locationId)await this.activeLocation(m,tenantId,locationId);
      await m.query(`UPDATE inventory_waste_records SET location_id=$3,wasted_at=COALESCE($4::timestamptz,wasted_at),reason=COALESCE($5,reason),note=CASE WHEN $6 THEN $7 ELSE note END,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,locationId,this.wasteDate(input.wastedAt),input.reason??null,input.note!==undefined,input.note?.trim()||null]);
      if(input.items){
        const items=await this.normalizeWasteItems(m,tenantId,locationId,input.items);
        await m.query(`DELETE FROM inventory_waste_items WHERE coffee_shop_id=$1 AND waste_record_id=$2`,[tenantId,id]);
        for(const line of items)await m.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,batch_id,item_name_snapshot,quantity_display,unit,quantity_base) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantId,id,line.item.id,line.batchId,line.item.name,line.quantity,line.unit,line.quantityBase]);
      }
    });
    return this.wasteRecord(tenantId,id);
  }

  async postWasteRecord(tenantId: string, actorId: string, id: string) {
    await this.gate(tenantId);
    await this.db.transaction(async(m)=>{
      const [record]=await m.query(`SELECT * FROM inventory_waste_records WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!record)throw new NotFoundException("Waste record not found");
      if(record.status!==InventoryWasteStatus.Draft)return;
      await this.activeLocation(m,tenantId,record.location_id);
      const lines=await m.query(`SELECT wi.id,wi.item_id AS "itemId",wi.batch_id AS "batchId",wi.item_name_snapshot AS "itemName",wi.quantity_display::text AS quantity,wi.unit,wi.quantity_base::text AS "quantityBase",i.dimension,i.base_unit AS "baseUnit",i.is_active AS "isActive"
        FROM inventory_waste_items wi JOIN inventory_items i ON i.coffee_shop_id=wi.coffee_shop_id AND i.id=wi.item_id WHERE wi.coffee_shop_id=$1 AND wi.waste_record_id=$2 ORDER BY wi.item_id,wi.batch_id NULLS FIRST,wi.id FOR UPDATE OF wi,i`,[tenantId,id]);
      if(!lines.length)throw new BadRequestException("Add at least one item before posting waste");
      for(const line of lines){
        if(!line.isActive)throw new ConflictException("Inactive inventory items cannot be posted as waste");
        const normalized=quantityToBase(line.quantity,line.dimension,line.unit,line.baseUnit);
        if(compareQuantities(normalized,line.quantityBase)!==0||compareQuantities(normalized,"0")<=0)throw new ConflictException("Waste quantity changed after it was saved");
        await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,line.itemId,record.location_id]);
        await m.query(`SELECT id FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,[tenantId,line.itemId,record.location_id]);
      }
      for(const line of lines){
        if(!line.batchId)continue;
        const [batch]=await m.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 AND item_id=$3 AND location_id=$4 FOR UPDATE`,[tenantId,line.batchId,line.itemId,record.location_id]);
        if(!batch||compareQuantities(line.quantityBase,batch.quantity)>0)throw new ConflictException("Waste quantity exceeds the selected batch quantity");
      }
      for(const line of lines){
        const [balance]=await m.query(`SELECT average_unit_cost_toman::text AS cost FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,line.itemId,record.location_id]);
        let totalCostToman:string|null=null;
        if(balance.cost!==null){const [cost]=await m.query(`SELECT ROUND($1::numeric*$2::numeric)::bigint::text AS value`,[line.quantityBase,balance.cost]);totalCostToman=cost.value;}
        const movement=await this.postMovement(m,tenantId,actorId,{itemId:line.itemId,batchId:line.batchId,locationId:record.location_id,type:InventoryMovementType.Waste,quantity:`-${line.quantityBase}`,reason:`WASTE:${record.reason}`,idempotencyKey:`waste:${id}:${line.id}`,sourceType:"WASTE_RECORD",sourceId:id,sourceLineId:line.id,unitCostToman:balance.cost,totalCostToman});
        await m.query(`UPDATE inventory_waste_items SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,line.id,movement.id]);
      }
      await m.query(`UPDATE inventory_waste_records SET status='POSTED',posted_by_user_id=$3,posted_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,actorId]);
    });
    return this.wasteRecord(tenantId,id);
  }

  async reverseWasteRecord(tenantId: string, actorId: string, id: string) {
    await this.gate(tenantId);
    await this.db.transaction(async(m)=>{
      const [record]=await m.query(`SELECT * FROM inventory_waste_records WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!record)throw new NotFoundException("Waste record not found");
      if(record.status===InventoryWasteStatus.Reversed)return;
      if(record.status!==InventoryWasteStatus.Posted)throw new ConflictException("Only posted waste can be reversed");
      const lines=await m.query(`SELECT wi.id,wi.item_id AS "itemId",wi.batch_id AS "batchId",wi.quantity_base::text AS "quantityBase",wi.movement_id AS "movementId",m.quantity_base::text AS "movementQuantity"
        FROM inventory_waste_items wi JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id
        WHERE wi.coffee_shop_id=$1 AND wi.waste_record_id=$2 ORDER BY wi.item_id FOR UPDATE OF wi,m`,[tenantId,id]);
      if(!lines.length)throw new ConflictException("Posted waste movements are unavailable");
      for(const line of lines){
        if(!line.movementQuantity.startsWith("-"))throw new ConflictException("Waste movement has an invalid quantity");
        await this.postMovement(m,tenantId,actorId,{itemId:line.itemId,batchId:line.batchId,locationId:record.location_id,type:InventoryMovementType.ManualAdjustment,quantity:line.movementQuantity.slice(1),reason:`WASTE_REVERSAL:${id}`,idempotencyKey:`waste-reversal:${id}:${line.id}`,sourceType:"WASTE_REVERSAL",sourceId:id,sourceLineId:line.id});
      }
      await m.query(`UPDATE inventory_waste_records SET status='REVERSED',reversed_by_user_id=$3,reversed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,actorId]);
    });
    return this.wasteRecord(tenantId,id);
  }

  async createItem(tenantId: string, actorId: string, input: CreateInventoryItemDto) {
    await this.gate(tenantId);
    this.assertUnit(input.dimension,input.baseUnit);
    return this.db.transaction(async (m) => {
      const batchTracking = input.batchTrackingEnabled === true, expiryTracking = input.expiryTrackingEnabled === true;
      if (expiryTracking && !batchTracking) throw new BadRequestException("Expiry tracking requires batch tracking");
      if (input.openingBatches?.length && !batchTracking) throw new BadRequestException("Opening batches require batch tracking");
      if (input.categoryId) await this.activeCategory(m,tenantId,input.categoryId);
      const locationId = input.locationId ?? (await this.defaultLocation(m,tenantId)).id;
      await this.activeLocation(m,tenantId,locationId);
      const [item] = await m.query(`INSERT INTO inventory_items(coffee_shop_id,name,sku,description,dimension,base_unit,category_id,batch_tracking_enabled,expiry_tracking_enabled,expiry_warning_days) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id,name,sku,description,dimension,base_unit AS "baseUnit",category_id AS "categoryId",is_active AS "isActive",batch_tracking_enabled AS "batchTrackingEnabled",expiry_tracking_enabled AS "expiryTrackingEnabled",expiry_warning_days AS "expiryWarningDays"`,[tenantId,input.name.trim(),input.sku?.trim() || null,input.description?.trim() || null,input.dimension,input.baseUnit,input.categoryId ?? null,batchTracking,expiryTracking,input.expiryWarningDays ?? 3]);
      const openingQuantity = input.openingQuantity ? quantityToBase(input.openingQuantity,input.dimension,input.baseUnit,input.baseUnit) : "0";
      if (batchTracking && openingQuantity !== "0" && !input.openingBatches?.length) throw new BadRequestException("Batch-tracked opening stock must be entered as one or more batches");
      if (input.openingBatches?.length) {
        let total = "0";
        for (const batchInput of input.openingBatches) total = addQuantities(total, quantityToBase(batchInput.quantity, input.dimension, input.baseUnit, input.baseUnit));
        if (batchTracking && compareQuantities(total, openingQuantity) !== 0) throw new BadRequestException("Opening batch quantities must equal opening stock");
      for (const [index, batchInput] of input.openingBatches.entries()) {
          this.assertDatePair(batchInput.manufacturedDate, batchInput.expiryDate);
          if (batchInput.expiryDate && !expiryTracking) throw new BadRequestException("Expiry dates require expiry tracking to be enabled");
          if (expiryTracking && !batchInput.expiryDate) throw new BadRequestException("Expiry tracking requires an expiry date on every opening batch");
          const quantity = quantityToBase(batchInput.quantity, input.dimension, input.baseUnit, input.baseUnit);
          if (compareQuantities(quantity, "0") <= 0) throw new BadRequestException("Batch quantity must be greater than zero");
          const batchId = await this.insertBatch(m, tenantId, { itemId: item.id, locationId, quantity, originType: "OPENING_BALANCE", supplierLotNumber: batchInput.supplierLotNumber?.trim() || null, manufacturedDate: batchInput.manufacturedDate ?? null, expiryDate: batchInput.expiryDate ?? null, actorId });
          await this.postMovement(m,tenantId,actorId,{itemId:item.id,locationId,batchId,type:InventoryMovementType.OpeningBalance,quantity,reason:"Opening balance",idempotencyKey:`opening:${item.id}:${index}:${batchId}`,sourceType:"OPENING_BALANCE",sourceId:item.id,sourceLineId:batchId});
        }
      } else if (openingQuantity !== "0") {
        await this.postMovement(m,tenantId,actorId,{itemId:item.id,locationId,type:InventoryMovementType.OpeningBalance,quantity:openingQuantity,reason:"Opening balance",idempotencyKey:`opening:${item.id}`,sourceType:"OPENING_BALANCE",sourceId:item.id});
      }
      return item;
    }).catch(uniqueConflict);
  }
  async updateItem(tenantId: string, id: string, input: UpdateInventoryItemDto) {
    await this.gate(tenantId);
    return this.db.transaction(async (m) => {
      const [current] = await m.query(`SELECT id,batch_tracking_enabled AS "batchTrackingEnabled",expiry_tracking_enabled AS "expiryTrackingEnabled" FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, id]);
      if (!current) throw new NotFoundException("Inventory item not found");
      const batchTracking = input.batchTrackingEnabled ?? current.batchTrackingEnabled, expiryTracking = input.expiryTrackingEnabled ?? current.expiryTrackingEnabled;
      if (expiryTracking && !batchTracking) throw new BadRequestException("Expiry tracking requires batch tracking");
      if (current.batchTrackingEnabled && !batchTracking) {
        const [stock] = await m.query(`SELECT EXISTS(SELECT 1 FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2 AND remaining_quantity_base>0) OR EXISTS(SELECT 1 FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND quantity_base>0) AS has_stock`, [tenantId, id]);
        if (stock.has_stock) throw new ConflictException("Batch tracking cannot be disabled while batch stock remains");
      }
      if (input.categoryId) await this.activeCategory(m,tenantId,input.categoryId);
      const rows = await m.query(`UPDATE inventory_items SET name=COALESCE($3,name),sku=CASE WHEN $4 THEN $5 ELSE sku END,description=CASE WHEN $6 THEN $7 ELSE description END,category_id=CASE WHEN $8 THEN $9 ELSE category_id END,is_active=COALESCE($10,is_active),batch_tracking_enabled=$11,expiry_tracking_enabled=$12,expiry_warning_days=COALESCE($13,expiry_warning_days),updated_at=now() WHERE coffee_shop_id=$1 AND id=$2 RETURNING id,name,sku,description,dimension,base_unit AS "baseUnit",category_id AS "categoryId",is_active AS "isActive",batch_tracking_enabled AS "batchTrackingEnabled",expiry_tracking_enabled AS "expiryTrackingEnabled",expiry_warning_days AS "expiryWarningDays"`,[tenantId,id,input.name?.trim() ?? null,input.sku !== undefined,input.sku?.trim() || null,input.description !== undefined,input.description?.trim() || null,input.categoryId !== undefined,input.categoryId ?? null,input.isActive ?? null,batchTracking,expiryTracking,input.expiryWarningDays ?? null]).catch(uniqueConflict);
      const row=firstRow(rows);if (!row) throw new NotFoundException("Inventory item not found");
      return row;
    });
  }

  async adjust(tenantId: string, actorId: string, input: StockAdjustmentDto) {
    await this.gate(tenantId);
    if (!input.quantity || input.quantity === "0" || input.quantity === "-0") throw new BadRequestException("Adjustment quantity must be nonzero");
    return this.db.transaction(async (m) => {
      const item = await this.tenantRow(m,"inventory_items",input.itemId,tenantId);
      if (!item.is_active) throw new ConflictException("Inactive inventory item cannot be adjusted");
      await this.activeLocation(m,tenantId,input.locationId);
      const quantity = quantityToBase(input.quantity,item.dimension,item.base_unit,item.base_unit);
      if(quantity==="0")throw new BadRequestException("Adjustment quantity must be nonzero");
      if (input.batchId) {
        await this.lockBalance(m,tenantId,item.id,input.locationId);
        const [batch] = await m.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 AND item_id=$3 AND location_id=$4 FOR UPDATE`, [tenantId,input.batchId,item.id,input.locationId]);
        if (!batch) throw new NotFoundException("Inventory batch not found for this item and location");
        if (quantity.startsWith("-") && compareQuantities(quantity.slice(1),batch.quantity)>0) throw new ConflictException("Adjustment exceeds the selected batch quantity");
      }
      const operation = {itemId:item.id,locationId:input.locationId,type:InventoryMovementType.ManualAdjustment,reason:input.reason.trim(),idempotencyKey:input.idempotencyKey,sourceType:"MANUAL_ADJUSTMENT",sourceId:input.idempotencyKey};
      if (item.batch_tracking_enabled && !input.batchId && quantity.startsWith("-")) {
        const prior = await m.query(`SELECT id,item_id,location_id,type,reason,quantity_base::text AS quantity FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='MANUAL_ADJUSTMENT' AND source_id=$2 AND starts_with(idempotency_key,$3)`, [tenantId,input.idempotencyKey,`${input.idempotencyKey}:batch:`]);
        if (prior.length) {
          if (prior.some((row:Record<string,string>)=>row.item_id!==item.id||row.location_id!==input.locationId||row.type!==InventoryMovementType.ManualAdjustment||row.reason!==input.reason.trim()) || compareQuantities(prior.reduce((sum:string,row:Record<string,string>)=>addQuantities(sum,String(row.quantity)),"0"),quantity)!==0) throw new ConflictException("Idempotency key was already used for a different stock operation");
          const [balance] = await m.query(`SELECT quantity_base::text AS quantity FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId,item.id,input.locationId]);
          return {id:prior[0]!.id,balance:balance?.quantity??"0",duplicate:true};
        }
        return this.postFefoDecrease(m,tenantId,actorId,{...operation,quantity},true);
      }
      return this.postMovement(m,tenantId,actorId,{...operation,batchId:input.batchId??null,quantity,idempotencyKey:input.batchId?`${input.idempotencyKey}:batch:${input.batchId}`:input.idempotencyKey});
    });
  }

  async movements(tenantId: string, query: MovementListQueryDto) {
    await this.gate(tenantId);
    if(query.from&&query.to&&query.from>query.to)throw new BadRequestException("Start date must be before end date");
    const page=query.page??1,limit=query.limit??50,where=["m.coffee_shop_id=$1"],values:unknown[]=[tenantId];
    const add=(sql:string,v:unknown)=>{values.push(v);where.push(sql.replaceAll("?",`$${values.length}`));};
    if (query.itemId) add("m.item_id=?",query.itemId);
    if (query.batchId) add("m.batch_id=?",query.batchId);
    if (query.locationId) add("m.location_id=?",query.locationId);
    if (query.type) add("m.type=?",query.type);
    if (query.from) add("m.created_at>=?::date",query.from);
    if (query.to) add("m.created_at<?::date+interval '1 day'",query.to);
    if (query.search?.trim()) add("i.name ILIKE '%'||?||'%'",query.search.trim());
    const totals=[...values];values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT m.id,m.item_id AS "itemId",i.name AS "itemName",m.location_id AS "locationId",l.name AS "locationName",m.batch_id AS "batchId",COALESCE(NULLIF(b.supplier_lot_number,''),'BATCH-'||upper(left(b.id::text,8))) AS "batchNumber",m.type,m.quantity_base::text AS "quantityBase",m.unit_cost_toman::text AS "unitCostToman",m.total_cost_toman AS "totalCostToman",m.reason,m.source_type AS "sourceType",m.source_id AS "sourceId",m.source_line_id AS "sourceLineId",m.order_item_id AS "orderItemId",m.recipe_version_id AS "recipeVersionId",m.recipe_component_id AS "recipeComponentId",m.reversal_of_movement_id AS "reversalOfMovementId",m.actor_user_id AS "actorUserId",m.created_at AS "createdAt" FROM inventory_stock_movements m JOIN inventory_items i ON i.id=m.item_id AND i.coffee_shop_id=m.coffee_shop_id JOIN inventory_locations l ON l.id=m.location_id AND l.coffee_shop_id=m.coffee_shop_id LEFT JOIN inventory_batches b ON b.coffee_shop_id=m.coffee_shop_id AND b.id=m.batch_id WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC,m.id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count FROM inventory_stock_movements m JOIN inventory_items i ON i.id=m.item_id AND i.coffee_shop_id=m.coffee_shop_id WHERE ${where.join(" AND ")}`,totals);
    return {items:rows,page,limit,total:count};
  }

  async consumeOrder(manager: EntityManager, tenantId: string, orderId: string, actorId: string) {
    await this.lockOrder(manager, tenantId, orderId);
    const [alreadyApplied] = await manager.query(`SELECT id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='ORDER_CONSUMPTION' AND source_id=$2 AND type='SALE_CONSUMPTION' LIMIT 1`, [tenantId, orderId]);
    if (alreadyApplied) return { applied: false, duplicate: true };
    if (!(await this.subscriptions.featureState(tenantId, SubscriptionFeatures.Inventory, new Date(), manager)).enabled) return { applied: false, featureDisabled: true };

    const lines = await manager.query(`SELECT id,menu_item_id AS "menuItemId",menu_item_variant_id AS "variantId",quantity
      FROM order_items WHERE coffee_shop_id=$1 AND order_id=$2 ORDER BY id`, [tenantId, orderId]);
    if (!lines.length) throw new ConflictException("An order cannot be consumed without order items");
    const operations: Array<{ itemId: string; orderItemId: string; recipeVersionId: string; recipeComponentId: string; quantity: string }> = [];
    let skippedItems = 0;
    for (const line of lines) {
      if (!line.menuItemId) {
        skippedItems++;
        this.logger.warn(JSON.stringify({ event: "order_inventory_missing_menu_item", tenantId, orderId, orderItemId: line.id }));
        continue;
      }
      let recipe: Awaited<ReturnType<RecipesService["resolveActiveRecipe"]>>;
      try {
        recipe = await this.recipes.resolveActiveRecipe(tenantId, line.menuItemId, line.variantId, manager, false);
      } catch (error) {
        this.logger.error(JSON.stringify({ event: "order_inventory_recipe_resolution_failed", tenantId, orderId, orderItemId: line.id }), error instanceof Error ? error.stack : undefined);
        throw error;
      }
      if (!recipe) {
        skippedItems++;
        this.logger.warn(JSON.stringify({ event: "order_inventory_recipe_missing", tenantId, orderId, orderItemId: line.id }));
        continue;
      }
      for (const component of recipe.components) operations.push({
        itemId: component.inventoryItemId,
        orderItemId: line.id,
        recipeVersionId: recipe.recipeVersionId,
        recipeComponentId: component.recipeComponentId,
        quantity: multiplyQuantity(component.quantityBase, line.quantity),
      });
    }

    operations.sort((a, b) => a.itemId.localeCompare(b.itemId) || a.orderItemId.localeCompare(b.orderItemId) || a.recipeComponentId.localeCompare(b.recipeComponentId));
    if (!operations.length) return { applied: false, duplicate: false, skippedItems };
    const location = await this.defaultLocation(manager, tenantId);
    await this.activeLocation(manager, tenantId, location.id);
    const reason = `سفارش #${orderId.slice(0, 8).toUpperCase()}`;
    const tracking = new Map<string, boolean>();
    for (const operation of operations) if (!tracking.has(operation.itemId)) {
      const [item] = await manager.query(`SELECT batch_tracking_enabled FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2`, [tenantId,operation.itemId]);
      tracking.set(operation.itemId,item?.batch_tracking_enabled===true);
    }
    for (const operation of operations) {
      const movement: MovementOperation = {
        ...operation,locationId:location.id,type:InventoryMovementType.SaleConsumption,quantity:`-${operation.quantity}`,reason,
        idempotencyKey:`order-consumption:${operation.orderItemId}:${operation.recipeComponentId}`,sourceType:"ORDER_CONSUMPTION",sourceId:orderId,
      };
      if (tracking.get(operation.itemId)) await this.postFefoDecrease(manager,tenantId,actorId,{...movement,quantity:operation.quantity},false);
      else await this.postMovement(manager,tenantId,actorId,movement);
    }
    return { applied: true, duplicate: false, skippedItems };
  }

  async reverseOrder(manager: EntityManager, tenantId: string, orderId: string, actorId: string) {
    await this.lockOrder(manager, tenantId, orderId);
    const consumed = await manager.query(`SELECT id,item_id AS "itemId",location_id AS "locationId",batch_id AS "batchId",quantity_base::text AS quantity,
      unit_cost_toman::text AS "unitCostToman",total_cost_toman::text AS "totalCostToman",
      order_item_id AS "orderItemId",recipe_version_id AS "recipeVersionId",recipe_component_id AS "recipeComponentId"
      FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='ORDER_CONSUMPTION' AND source_id=$2 AND type='SALE_CONSUMPTION'
      ORDER BY item_id,id FOR UPDATE`, [tenantId, orderId]);
    const reason = `بازگشت سفارش #${orderId.slice(0, 8).toUpperCase()}`;
    for (const movement of consumed) {
      if (!movement.quantity.startsWith("-")) throw new ConflictException("An order consumption movement has an invalid quantity");
      await this.postMovement(manager, tenantId, actorId, {
        itemId: movement.itemId,
        batchId: movement.batchId,
        orderItemId: movement.orderItemId,
        recipeVersionId: movement.recipeVersionId,
        recipeComponentId: movement.recipeComponentId,
        unitCostToman: movement.unitCostToman,
        totalCostToman: movement.totalCostToman,
        reversalOfMovementId: movement.id,
        locationId: movement.locationId,
        type: InventoryMovementType.SaleReversal,
        quantity: movement.quantity.slice(1),
        reason,
        idempotencyKey: `order-reversal:${movement.id}`,
        sourceType: "ORDER_REVERSAL",
        sourceId: orderId,
      });
    }
    return { reversed: consumed.length > 0, movements: consumed.length };
  }

  async counts(tenantId:string,query:InventoryListQueryDto) {
    await this.gate(tenantId);
    const page=query.page??1,limit=query.limit??50;
    const items=await this.db.query(`SELECT c.id,c.location_id AS "locationId",l.name AS "locationName",c.status,c.note,c.created_at AS "createdAt",c.completed_at AS "completedAt",(SELECT count(*)::int FROM inventory_stock_count_lines cl WHERE cl.coffee_shop_id=c.coffee_shop_id AND cl.count_id=c.id) AS "lineCount" FROM inventory_stock_counts c JOIN inventory_locations l ON l.id=c.location_id AND l.coffee_shop_id=c.coffee_shop_id WHERE c.coffee_shop_id=$1 ORDER BY c.created_at DESC,c.id DESC LIMIT $2 OFFSET $3`,[tenantId,limit,(page-1)*limit]);
    const [{count:total}]=await this.db.query(`SELECT count(*)::int AS count FROM inventory_stock_counts WHERE coffee_shop_id=$1`,[tenantId]);
    return {items,page,limit,total};
  }
  async createCount(tenantId:string,actorId:string,input:CreateStockCountDto) {
    await this.gate(tenantId);
    await this.activeLocation(this.db.manager,tenantId,input.locationId);
    const [row]=await this.db.query(`INSERT INTO inventory_stock_counts(coffee_shop_id,location_id,note,created_by_user_id) VALUES($1,$2,$3,$4) RETURNING id,location_id AS "locationId",status,note,created_at AS "createdAt"`,[tenantId,input.locationId,input.note?.trim()??null,actorId]);return row;
  }
  async countDetail(tenantId:string,id:string) {
    await this.gate(tenantId);
    const [count]=await this.db.query(`SELECT c.id,c.location_id AS "locationId",l.name AS "locationName",c.status,c.note,c.created_at AS "createdAt",c.completed_at AS "completedAt" FROM inventory_stock_counts c JOIN inventory_locations l ON l.id=c.location_id AND l.coffee_shop_id=c.coffee_shop_id WHERE c.coffee_shop_id=$1 AND c.id=$2`,[tenantId,id]);
    if(!count)throw new NotFoundException("Stock count not found");
    count.lines=await this.db.query(`SELECT cl.id,cl.item_id AS "itemId",i.name AS "itemName",i.base_unit AS "baseUnit",cl.batch_id AS "batchId",cl.allocation_type AS "allocationType",COALESCE(NULLIF(b.supplier_lot_number,''),'BATCH-'||upper(left(b.id::text,8))) AS "batchNumber",cl.expected_quantity::text AS "expectedQuantity",cl.counted_quantity::text AS "countedQuantity",cl.variance_quantity::text AS "varianceQuantity" FROM inventory_stock_count_lines cl JOIN inventory_items i ON i.id=cl.item_id AND i.coffee_shop_id=cl.coffee_shop_id LEFT JOIN inventory_batches b ON b.coffee_shop_id=cl.coffee_shop_id AND b.id=cl.batch_id WHERE cl.coffee_shop_id=$1 AND cl.count_id=$2 ORDER BY i.name,cl.allocation_type,cl.batch_id`,[tenantId,id]);
    return count;
  }
  async saveCountLines(tenantId:string,id:string,input:UpdateStockCountLinesDto) {
    await this.gate(tenantId);
    if (new Set(input.lines.map(line=>`${line.itemId}:${line.allocationType??(line.batchId?"BATCH":"AGGREGATE")}:${line.batchId??"none"}`)).size!==input.lines.length) throw new BadRequestException("Duplicate item or batch in stock count");
    const itemModes=new Map<string,Set<string>>();for(const line of input.lines){const mode=line.allocationType??(line.batchId?"BATCH":"AGGREGATE");const modes=itemModes.get(line.itemId)??new Set<string>();modes.add(mode);itemModes.set(line.itemId,modes);}if([...itemModes.values()].some(modes=>modes.has("AGGREGATE")&&modes.size>1))throw new BadRequestException("Use either an aggregate count or batch counts for each item");
    await this.db.transaction(async(m)=>{
      const [count]=await m.query(`SELECT * FROM inventory_stock_counts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!count)throw new NotFoundException("Stock count not found");if(count.status!==InventoryCountStatus.Draft)throw new ConflictException("Completed stock counts cannot be changed");
      await m.query(`DELETE FROM inventory_stock_count_lines WHERE coffee_shop_id=$1 AND count_id=$2`,[tenantId,id]);
      const [{countedAt}]=await m.query(`SELECT clock_timestamp() AS "countedAt"`) as [{countedAt:Date}];
      for(const line of [...input.lines].sort((a,b)=>a.itemId.localeCompare(b.itemId))){
        const item=await this.tenantRow(m,"inventory_items",line.itemId,tenantId);
        if (!item.is_active) throw new ConflictException("Inactive inventory item cannot be counted");
        const allocationType=line.allocationType??(line.batchId?"BATCH":"AGGREGATE");
        if((allocationType==="BATCH")!==Boolean(line.batchId))throw new BadRequestException("Select a batch for batch counts only");
        if(allocationType!=="AGGREGATE"&&!item.batch_tracking_enabled)throw new BadRequestException("Batch allocation counts require batch tracking");
        if(allocationType==="AGGREGATE"&&item.batch_tracking_enabled)throw new BadRequestException("Batch-tracked items must be counted by batch and unallocated stock");
        const balance=await this.lockBalance(m,tenantId,line.itemId,count.location_id);
        let expected:string;
        if(allocationType==="BATCH"){
          const [batch]=await m.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 AND item_id=$3 AND location_id=$4 FOR UPDATE`,[tenantId,line.batchId,line.itemId,count.location_id]);
          if(!batch)throw new NotFoundException("Inventory batch not found for this count");expected=batch.quantity;
        }else{
          expected=balance.quantity;
          if(allocationType==="UNALLOCATED"){
            const [allocated]=await m.query(`SELECT COALESCE(sum(remaining_quantity_base),0)::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,line.itemId,count.location_id]);
            expected=addQuantities(expected,`-${allocated.quantity}`);
          }
        }
        const counted=quantityToBase(line.countedQuantity,item.dimension,item.base_unit,item.base_unit);
        await m.query(`INSERT INTO inventory_stock_count_lines(coffee_shop_id,count_id,item_id,batch_id,allocation_type,expected_quantity,counted_quantity,counted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[tenantId,id,line.itemId,line.batchId??null,allocationType,expected,counted,countedAt]);
      }
    });
    return this.countDetail(tenantId,id);
  }
  async completeCount(tenantId:string,actorId:string,id:string) {
    await this.gate(tenantId);
    await this.db.transaction(async(m)=>{
      const [count]=await m.query(`SELECT * FROM inventory_stock_counts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!count)throw new NotFoundException("Stock count not found");if(count.status!==InventoryCountStatus.Draft)throw new ConflictException("Stock count is already completed");
      const lines=await m.query(`SELECT * FROM inventory_stock_count_lines WHERE coffee_shop_id=$1 AND count_id=$2 ORDER BY item_id,batch_id FOR UPDATE`,[tenantId,id]);
      if(!lines.length)throw new BadRequestException("Add counted items before completing the count");
      const itemIds=[...new Set<string>(lines.map((line:Record<string,string>)=>line.item_id))].sort();
      for(const itemId of itemIds)await this.lockBalance(m,tenantId,itemId,count.location_id);
      for(const itemId of itemIds){
        const itemLines=lines.filter((line:Record<string,string>)=>line.item_id===itemId);
        const [item]=await m.query(`SELECT batch_tracking_enabled FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,itemId]);
        if(item.batch_tracking_enabled){
          if(!itemLines.some((line:Record<string,string>)=>line.allocation_type==="UNALLOCATED"))throw new BadRequestException("Batch counts must include unallocated stock");
          if(itemLines.some((line:Record<string,string>)=>line.allocation_type==="AGGREGATE"))throw new BadRequestException("Batch-tracked items must be counted by batch and unallocated stock");
          const [missing]=await m.query(`SELECT EXISTS(SELECT 1 FROM inventory_batches b WHERE b.coffee_shop_id=$1 AND b.item_id=$2 AND b.location_id=$3 AND b.remaining_quantity_base>0 AND NOT EXISTS(SELECT 1 FROM inventory_stock_count_lines cl WHERE cl.coffee_shop_id=$1 AND cl.count_id=$4 AND cl.item_id=$2 AND cl.batch_id=b.id AND cl.allocation_type='BATCH')) AS missing`,[tenantId,itemId,count.location_id,id]);
          if(missing.missing)throw new ConflictException("Batch stock changed; include every remaining batch before completing this count");
        }
      }
      await m.query(`SELECT b.id FROM inventory_batches b JOIN inventory_stock_count_lines cl ON cl.coffee_shop_id=b.coffee_shop_id AND cl.batch_id=b.id WHERE b.coffee_shop_id=$1 AND cl.count_id=$2 ORDER BY b.item_id,b.id FOR UPDATE OF b`,[tenantId,id]);
      for(const line of lines){
        let currentQuantity:string;
        if(line.batch_id){
          const [batch]=await m.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 AND item_id=$3 AND location_id=$4 FOR UPDATE`,[tenantId,line.batch_id,line.item_id,count.location_id]);
          if(!batch)throw new ConflictException("A counted batch is no longer available");currentQuantity=batch.quantity;
        }else {
          const balance=(await this.lockBalance(m,tenantId,line.item_id,count.location_id)).quantity;
          if(line.allocation_type==="UNALLOCATED"){
            const [allocated]=await m.query(`SELECT COALESCE(sum(remaining_quantity_base),0)::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,line.item_id,count.location_id]);
            currentQuantity=addQuantities(balance,`-${allocated.quantity}`);
          }else currentQuantity=balance;
        }
        const [since]=await m.query(`SELECT COALESCE(sum(quantity_base),0)::text AS quantity FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 AND created_at>$4 AND (($5::uuid IS NOT NULL AND batch_id=$5) OR ($5::uuid IS NULL AND ($6<>'UNALLOCATED' OR batch_id IS NULL)))`,[tenantId,line.item_id,count.location_id,line.counted_at,line.batch_id,line.allocation_type]);
        const variance=addQuantities(line.counted_quantity,`-${line.expected_quantity}`);
        const delta=addQuantities(line.counted_quantity,since.quantity,`-${currentQuantity}`);
        let movementId:string|null=null;
        if(delta!=="0"){
          if(!line.batch_id&&line.allocation_type==="AGGREGATE"&&delta.startsWith("-")){
            const result=await this.postMovement(m,tenantId,actorId,{itemId:line.item_id,batchId:null,locationId:count.location_id,type:InventoryMovementType.StockCountAdjustment,quantity:delta,reason:`Stock count ${id}`,idempotencyKey:`count:${id}:${line.id}:unallocated`,sourceType:"STOCK_COUNT",sourceId:line.id,sourceLineId:line.id});
            movementId=result.id;
          }else{
            const result=await this.postMovement(m,tenantId,actorId,{itemId:line.item_id,batchId:line.batch_id??null,locationId:count.location_id,type:InventoryMovementType.StockCountAdjustment,quantity:delta,reason:`Stock count ${id}`,idempotencyKey:`count:${id}:${line.id}:${line.batch_id??"unallocated"}`,sourceType:"STOCK_COUNT",sourceId:line.id,sourceLineId:line.id});
            movementId=result.id;
          }
        }
        await m.query(`UPDATE inventory_stock_count_lines SET variance_quantity=$3,movement_id=$4 WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,line.id,variance,movementId]);
      }
      await m.query(`UPDATE inventory_stock_counts SET status='COMPLETED',completed_by_user_id=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,actorId]);
    });
    return this.countDetail(tenantId,id);
  }

  private async normalizeWasteItems(m:EntityManager,tenantId:string,locationId:string,items:CreateWasteRecordDto["items"]){
    if(!items.length)throw new BadRequestException("Add at least one item to a waste record");
    if(new Set(items.map((line)=>`${line.inventoryItemId}:${line.batchId??"unallocated"}`)).size!==items.length)throw new BadRequestException("An item and batch can appear only once in a waste record");
    const normalized=[];
    for(const line of items){
      const [item]=await m.query(`SELECT id,name,dimension,base_unit,is_active,batch_tracking_enabled FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`,[tenantId,line.inventoryItemId]);
      if(!item)throw new NotFoundException("Inventory item not found");
      if(!item.is_active)throw new ConflictException("Inactive inventory items cannot be selected for waste");
      if(line.batchId){const [batch]=await m.query(`SELECT id FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2 AND item_id=$3 AND location_id=$4 FOR SHARE`,[tenantId,line.batchId,line.inventoryItemId,locationId]);if(!batch)throw new NotFoundException("Inventory batch not found for this item and location");}
      const quantityBase=quantityToBase(line.quantity,item.dimension,line.unit,item.base_unit);
      if(compareQuantities(quantityBase,"0")<=0)throw new BadRequestException("Waste quantity must be greater than zero");
      normalized.push({item,batchId:line.batchId??null,quantity:line.quantity,unit:line.unit,quantityBase});
    }
    return normalized;
  }
  private wasteDate(value?:string){
    if(!value)return null;
    const date=new Date(value);
    if(!Number.isFinite(date.getTime()))throw new BadRequestException("Waste date is invalid");
    return date.toISOString();
  }
  private async evaluateStockAlert(m:EntityManager,tenantId:string,itemId:string,locationId:string){
    const [stock]=await m.query(`SELECT b.quantity_base::text AS quantity,r.minimum_quantity_base::text AS minimum,r.par_quantity_base::text AS par
      FROM inventory_stock_balances b LEFT JOIN inventory_stock_rules r ON r.coffee_shop_id=b.coffee_shop_id AND r.item_id=b.item_id AND r.location_id=b.location_id
      WHERE b.coffee_shop_id=$1 AND b.item_id=$2 AND b.location_id=$3`,[tenantId,itemId,locationId]);
    if(!stock)return;
    const status=inventoryStockStatus(stock.quantity,stock.minimum,stock.par);
    const type=status===InventoryStockStatus.Negative?InventoryStockAlertType.Negative:status===InventoryStockStatus.OutOfStock?InventoryStockAlertType.OutOfStock:status===InventoryStockStatus.LowStock?InventoryStockAlertType.LowStock:null;
    const [open]=await m.query(`SELECT id,alert_type AS type FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 AND status='OPEN' AND batch_id IS NULL FOR UPDATE`,[tenantId,itemId,locationId]);
    if(type===null){
      if(open)await m.query(`UPDATE inventory_stock_alerts SET status='RESOLVED',last_observed_at=clock_timestamp(),resolved_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,open.id]);
    }else if(open){
      await m.query(`UPDATE inventory_stock_alerts SET alert_type=$3,last_observed_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,open.id,type]);
    }else{
      await m.query(`INSERT INTO inventory_stock_alerts(coffee_shop_id,item_id,location_id,alert_type,status,opened_at,last_observed_at) VALUES($1,$2,$3,$4,'OPEN',clock_timestamp(),clock_timestamp()) ON CONFLICT(coffee_shop_id,item_id,location_id) WHERE status='OPEN' AND batch_id IS NULL DO UPDATE SET alert_type=EXCLUDED.alert_type,last_observed_at=clock_timestamp()`,[tenantId,itemId,locationId,type]);
    }
  }
  private assertUnit(dimension:InventoryDimension,unit:string){
    const valid=dimension===InventoryDimension.Weight?["g","kg"]:dimension===InventoryDimension.Volume?["ml","l"]:["piece","pack","box","bottle"];
    if(!valid.includes(unit))throw new BadRequestException("Base unit does not match the measurement dimension");
  }
  private async activeCategory(m:EntityManager,tenantId:string,id:string){const [row]=await m.query(`SELECT id FROM inventory_categories WHERE coffee_shop_id=$1 AND id=$2 AND is_active`,[tenantId,id]);if(!row)throw new NotFoundException("Active inventory category not found");}
  async activeLocation(m:EntityManager,tenantId:string,id:string){const [row]=await m.query(`SELECT id FROM inventory_locations WHERE coffee_shop_id=$1 AND id=$2 AND is_active FOR SHARE`,[tenantId,id]);if(!row)throw new NotFoundException("Active inventory location not found");return row;}
  private async lockOrder(m:EntityManager,tenantId:string,orderId:string){
    // ponytail: hashtext collisions only serialize unrelated orders; use hashtextextended if contention appears.
    await m.query(`SELECT pg_advisory_xact_lock(hashtext($1))`,[`inventory-order:${tenantId}:${orderId}`]);
  }
  async defaultLocation(m:EntityManager,tenantId:string){
    const [existing]=await m.query(`SELECT * FROM inventory_locations WHERE coffee_shop_id=$1 AND is_default`,[tenantId]);if(existing)return existing;
    await m.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default) VALUES($1,'Main Inventory',true) ON CONFLICT(coffee_shop_id) WHERE is_default DO NOTHING`,[tenantId]);
    const [created]=await m.query(`SELECT * FROM inventory_locations WHERE coffee_shop_id=$1 AND is_default`,[tenantId]);if(!created)throw new ConflictException("Could not create a default inventory location");return created;
  }
  async postPurchaseReceipt(m:EntityManager,tenantId:string,actorId:string,op:{itemId:string;locationId:string;batchId?:string|null;quantity:string;totalCostToman:string;receiptId:string;lineId:string;reason:string}){
    const [cost] = await m.query(`SELECT ROUND($1::numeric/$2::numeric,6)::text AS unit_cost_toman`, [op.totalCostToman, op.quantity]);
    return this.postMovement(m,tenantId,actorId,{...op,type:InventoryMovementType.PurchaseReceipt,unitCostToman:cost.unit_cost_toman,idempotencyKey:`goods-receipt:${op.lineId}${op.batchId?`:${op.batchId}`:""}`,sourceType:"GOODS_RECEIPT",sourceId:op.receiptId,sourceLineId:op.batchId?`${op.lineId}:${op.batchId}`:op.lineId});
  }
  async createReceiptBatch(m:EntityManager,tenantId:string,actorId:string,input:{itemId:string;locationId:string;quantity:string;supplierLotNumber:string|null;manufacturedDate:string|null;expiryDate:string|null;receiptId:string;lineId:string;unitCostToman:string;totalCostToman:string}){
    return this.insertBatch(m,tenantId,{...input,originType:"GOODS_RECEIPT",receiptLineId:input.lineId,actorId,receivedAt:null});
  }
  private async postMovement(m:EntityManager,tenantId:string,actorId:string|null,op:MovementOperation){
    if(op.type===InventoryMovementType.PurchaseReceipt&&(!op.sourceLineId||!op.unitCostToman||op.totalCostToman===undefined||op.totalCostToman===null))throw new BadRequestException("Purchase receipts require source line and actual cost data");
    const checkPrior=async()=>{
      const [prior]=await m.query(`SELECT id,item_id,location_id,batch_id,type,quantity_base::text,reason,source_type,source_id,source_line_id,unit_cost_toman::text,total_cost_toman,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND idempotency_key=$2`,[tenantId,op.idempotencyKey]);
      if(!prior)return null;
      const autoCost = op.type === InventoryMovementType.SaleConsumption && op.unitCostToman === undefined && op.totalCostToman === undefined;
      if(prior.item_id!==op.itemId||prior.location_id!==op.locationId||prior.batch_id!==(op.batchId??null)||prior.type!==op.type||addQuantities(prior.quantity_base)!==addQuantities(op.quantity)||prior.reason!==op.reason||prior.source_type!==op.sourceType||prior.source_id!==op.sourceId||prior.source_line_id!==(op.sourceLineId??null)||(!autoCost&&(prior.unit_cost_toman!==(op.unitCostToman??null)||prior.total_cost_toman!==(op.totalCostToman??null)))||prior.order_item_id!==(op.orderItemId??null)||prior.recipe_version_id!==(op.recipeVersionId??null)||prior.recipe_component_id!==(op.recipeComponentId??null)||prior.reversal_of_movement_id!==(op.reversalOfMovementId??null))throw new ConflictException("Idempotency key was already used for a different stock operation");
      const [balance]=await m.query(`SELECT quantity_base::text AS quantity_base FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId]);return {id:prior.id,balance:balance?.quantity_base??"0",duplicate:true};
    };
    const prior=await checkPrior();if(prior)return prior;
    await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,op.itemId,op.locationId]);
    await m.query(`SELECT id FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,[tenantId,op.itemId,op.locationId]);
    const afterLock=await checkPrior();if(afterLock)return afterLock;
    if(op.type===InventoryMovementType.SaleConsumption&&op.unitCostToman===undefined&&op.totalCostToman===undefined){
      const [balanceCost]=await m.query(`SELECT average_unit_cost_toman::text AS cost FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId]);
      op.unitCostToman=balanceCost.cost;
      op.totalCostToman=null;
      if(balanceCost.cost!==null){const [total]=await m.query(`SELECT ROUND(ABS($1::numeric)*$2::numeric)::bigint::text AS value`,[op.quantity,balanceCost.cost]);op.totalCostToman=total.value;}
    }
    const [movement]=await m.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,batch_id,type,quantity_base,unit_cost_toman,total_cost_toman,source_type,source_id,source_line_id,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id,idempotency_key,actor_user_id,reason,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,clock_timestamp())
      ON CONFLICT(coffee_shop_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [tenantId,op.itemId,op.locationId,op.batchId??null,op.type,op.quantity,op.unitCostToman??null,op.totalCostToman??null,op.sourceType,op.sourceId,op.sourceLineId??null,op.orderItemId??null,op.recipeVersionId??null,op.recipeComponentId??null,op.reversalOfMovementId??null,op.idempotencyKey,actorId,op.reason]);
    if(!movement){const duplicate=await checkPrior();if(duplicate)return duplicate;throw new ConflictException("Stock movement could not be recorded");}
    await m.query(`UPDATE inventory_stock_balances SET quantity_base=quantity_base+$4,
      average_unit_cost_toman=CASE WHEN $5='PURCHASE_RECEIPT' THEN CASE WHEN quantity_base<=0 OR average_unit_cost_toman IS NULL THEN $6::numeric ELSE ROUND((quantity_base*average_unit_cost_toman+$7::numeric)/(quantity_base+$4::numeric),6) END ELSE average_unit_cost_toman END,
      updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId,op.quantity,op.type,op.unitCostToman??null,op.totalCostToman??null]);
    const [balance]=await m.query(`SELECT quantity_base::text AS quantity_base FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId]);
    await this.evaluateStockAlert(m,tenantId,op.itemId,op.locationId);
    if(op.batchId)await this.evaluateBatchExpiryAlert(m,tenantId,op.batchId);
    return {id:movement.id,balance:balance.quantity_base,duplicate:false};
  }
}
