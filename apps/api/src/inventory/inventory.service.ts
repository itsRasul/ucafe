import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { CreateInventoryCategoryDto, CreateInventoryItemDto, CreateInventoryLocationDto, CreateStockCountDto, CreateWasteRecordDto, InventoryListQueryDto, InventoryStockSettingsDto, MovementListQueryDto, StockAdjustmentDto, StockAlertListQueryDto, UpdateInventoryCategoryDto, UpdateInventoryItemDto, UpdateInventoryLocationDto, UpdateStockCountLinesDto, UpdateWasteRecordDto, WasteListQueryDto } from "./inventory.dto";
import { InventoryCountStatus, InventoryDimension, InventoryMovementType, InventoryStockAlertStatus, InventoryStockAlertType, InventoryStockStatus, InventoryWasteReason, InventoryWasteStatus } from "./entities";
import { addQuantities, multiplyQuantity, quantityFromBase, quantityToBase } from "./quantity.util";
import { compareQuantities, inventoryStockStatus } from "./stock.util";
import { RecipesService } from "./recipes.service";

type Row = { id: string; is_active: boolean; dimension: InventoryDimension; base_unit: string };
const uniqueConflict = (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw new ConflictException("Inventory name or SKU already exists");
  throw error;
};
const firstRow = <T>(rows: T[]) => { const row=rows[0]; return (Array.isArray(row)?row[0]:row) as T|undefined; };

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService, private readonly recipes: RecipesService) {}
  private async gate(tenantId: string) { await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory); }
  private async tenantRow(manager: EntityManager, table: string, id: string, tenantId: string) {
    const rows = await manager.query(`SELECT * FROM ${table} WHERE id=$1 AND coffee_shop_id=$2 FOR SHARE`, [id, tenantId]) as Row[];
    if (!rows[0]) throw new NotFoundException("Inventory record not found");
    return rows[0];
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
      (SELECT CASE WHEN count(m.total_cost_toman)>0 THEN sum(m.total_cost_toman)::text ELSE NULL END FROM inventory_waste_records w JOIN inventory_waste_items wi ON wi.coffee_shop_id=w.coffee_shop_id AND wi.waste_record_id=w.id JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id WHERE w.coffee_shop_id=$1 AND w.status='POSTED' AND w.wasted_at>=date_trunc('month',now())) AS "estimatedWasteCostThisMonth"`, [tenantId]);
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
    const rows = await this.db.query(`SELECT i.id,i.name,i.sku,i.description,i.dimension,i.base_unit AS "baseUnit",i.category_id AS "categoryId",c.name AS "categoryName",i.is_active AS "isActive",i.created_at AS "createdAt",i.updated_at AS "updatedAt" FROM inventory_items i LEFT JOIN inventory_categories c ON c.id=i.category_id AND c.coffee_shop_id=i.coffee_shop_id WHERE ${where.join(" AND ")} ORDER BY i.name LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{ count }] = await this.db.query(`SELECT count(*)::int AS count FROM inventory_items i WHERE ${where.join(" AND ")}`,countValues);
    return { items: rows, page, limit, total: count };
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
    const rows=await this.db.query(`SELECT i.id AS "itemId",i.name,i.sku,i.dimension,i.base_unit AS "baseUnit",i.is_active AS "isActive",c.name AS "categoryName",l.id AS "locationId",l.name AS "locationName",l.is_default AS "isDefault",COALESCE(b.quantity_base,0)::text AS "quantityBase",b.average_unit_cost_toman::text AS "averageUnitCostToman",r.minimum_quantity_base::text AS "minimumQuantityBase",r.par_quantity_base::text AS "parQuantityBase",r.display_unit AS "thresholdUnit",${status} AS "stockStatus",
      COALESCE(on_order.quantity_base,0)::text AS "onOrderQuantityBase",(COALESCE(b.quantity_base,0)+COALESCE(on_order.quantity_base,0))::text AS "projectedQuantityBase",
      CASE WHEN r.par_quantity_base IS NULL THEN NULL ELSE greatest(r.par_quantity_base-COALESCE(b.quantity_base,0),0)::text END AS "parGapBase",
      CASE WHEN r.par_quantity_base IS NULL THEN NULL ELSE greatest(r.par_quantity_base-(COALESCE(b.quantity_base,0)+COALESCE(on_order.quantity_base,0)),0)::text END AS "projectedParGapBase",
      (SELECT max(m.created_at) FROM inventory_stock_movements m WHERE m.coffee_shop_id=i.coffee_shop_id AND m.item_id=i.id AND m.location_id=l.id) AS "lastMovementAt" ${from} WHERE ${where.join(" AND ")} ORDER BY i.is_active DESC,i.name,l.is_default DESC,l.name LIMIT $${values.length-1} OFFSET $${values.length}`, values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`,countValues);
    const items=rows.map((row:Record<string,string|null>)=>{
      const baseUnit=row.baseUnit!,dimension=row.dimension as InventoryDimension,unit=row.thresholdUnit??baseUnit;
      const display=(value:string|null|undefined)=>value==null?null:quantityFromBase(value,dimension,unit,baseUnit);
      return {...row,unit,quantity:display(row.quantityBase)!,minimumQuantity:display(row.minimumQuantityBase),parQuantity:display(row.parQuantityBase),onOrderQuantity:display(row.onOrderQuantityBase)!,projectedQuantity:display(row.projectedQuantityBase)!,parGap:display(row.parGapBase),projectedParGap:display(row.projectedParGapBase)};
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
    const page=query.page??1,limit=query.limit??50,values:unknown[]=[tenantId],where=["a.coffee_shop_id=$1"];
    if (query.status && query.status !== "ALL") { values.push(query.status); where.push(`a.status=$${values.length}`); }
    if (query.itemId) { values.push(query.itemId); where.push(`a.item_id=$${values.length}`); }
    if (query.locationId) { values.push(query.locationId); where.push(`a.location_id=$${values.length}`); }
    const from=`FROM inventory_stock_alerts a JOIN inventory_items i ON i.coffee_shop_id=a.coffee_shop_id AND i.id=a.item_id JOIN inventory_locations l ON l.coffee_shop_id=a.coffee_shop_id AND l.id=a.location_id LEFT JOIN inventory_stock_balances b ON b.coffee_shop_id=a.coffee_shop_id AND b.item_id=a.item_id AND b.location_id=a.location_id LEFT JOIN inventory_stock_rules r ON r.coffee_shop_id=a.coffee_shop_id AND r.item_id=a.item_id AND r.location_id=a.location_id`;
    const countValues=[...values];values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT a.id,a.item_id AS "itemId",i.name AS "itemName",i.dimension,i.base_unit AS "baseUnit",r.display_unit AS "displayUnit",a.location_id AS "locationId",l.name AS "locationName",a.alert_type AS type,a.status,a.opened_at AS "openedAt",a.last_observed_at AS "lastObservedAt",a.resolved_at AS "resolvedAt",COALESCE(b.quantity_base,0)::text AS "quantityBase",r.minimum_quantity_base::text AS "minimumQuantityBase",r.par_quantity_base::text AS "parQuantityBase" ${from} WHERE ${where.join(" AND ")} ORDER BY (a.status='OPEN') DESC,a.opened_at DESC,a.id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
    const [{count}]=await this.db.query(`SELECT count(*)::int AS count ${from} WHERE ${where.join(" AND ")}`,countValues);
    const items=rows.map((row:Record<string,string|null>)=>{const baseUnit=row.baseUnit!,dimension=row.dimension as InventoryDimension,unit=row.displayUnit??baseUnit;const display=(value:string|null|undefined)=>value==null?null:quantityFromBase(value,dimension,unit,baseUnit);return {...row,unit,quantity:display(row.quantityBase)!,minimumQuantity:display(row.minimumQuantityBase),parQuantity:display(row.parQuantityBase)};});
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
    record.items=await this.db.query(`SELECT wi.id,wi.item_id AS "itemId",wi.item_name_snapshot AS "itemName",i.dimension,i.base_unit AS "baseUnit",wi.quantity_display::text AS quantity,wi.unit,wi.quantity_base::text AS "quantityBase",wi.movement_id AS "movementId",m.unit_cost_toman::text AS "unitCostToman",m.total_cost_toman AS "totalCostToman"
      FROM inventory_waste_items wi JOIN inventory_items i ON i.coffee_shop_id=wi.coffee_shop_id AND i.id=wi.item_id LEFT JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id
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
      const items=await this.normalizeWasteItems(m,tenantId,input.items);
      const wastedAt=this.wasteDate(input.wastedAt);
      const [record]=await m.query(`INSERT INTO inventory_waste_records(coffee_shop_id,location_id,wasted_at,reason,note,created_by_user_id) VALUES($1,$2,COALESCE($3::timestamptz,clock_timestamp()),$4,$5,$6) RETURNING id`,[tenantId,input.locationId,wastedAt,input.reason,input.note?.trim()||null,actorId]);
      for(const line of items)await m.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,item_name_snapshot,quantity_display,unit,quantity_base) VALUES($1,$2,$3,$4,$5,$6,$7)`,[tenantId,record.id,line.item.id,line.item.name,line.quantity,line.unit,line.quantityBase]);
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
        const items=await this.normalizeWasteItems(m,tenantId,input.items);
        await m.query(`DELETE FROM inventory_waste_items WHERE coffee_shop_id=$1 AND waste_record_id=$2`,[tenantId,id]);
        for(const line of items)await m.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,item_name_snapshot,quantity_display,unit,quantity_base) VALUES($1,$2,$3,$4,$5,$6,$7)`,[tenantId,id,line.item.id,line.item.name,line.quantity,line.unit,line.quantityBase]);
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
      const lines=await m.query(`SELECT wi.id,wi.item_id AS "itemId",wi.item_name_snapshot AS "itemName",wi.quantity_display::text AS quantity,wi.unit,wi.quantity_base::text AS "quantityBase",i.dimension,i.base_unit AS "baseUnit",i.is_active AS "isActive"
        FROM inventory_waste_items wi JOIN inventory_items i ON i.coffee_shop_id=wi.coffee_shop_id AND i.id=wi.item_id WHERE wi.coffee_shop_id=$1 AND wi.waste_record_id=$2 ORDER BY wi.item_id FOR UPDATE OF wi,i`,[tenantId,id]);
      if(!lines.length)throw new BadRequestException("Add at least one item before posting waste");
      for(const line of lines){
        if(!line.isActive)throw new ConflictException("Inactive inventory items cannot be posted as waste");
        const normalized=quantityToBase(line.quantity,line.dimension,line.unit,line.baseUnit);
        if(compareQuantities(normalized,line.quantityBase)!==0||compareQuantities(normalized,"0")<=0)throw new ConflictException("Waste quantity changed after it was saved");
        await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,line.itemId,record.location_id]);
        await m.query(`SELECT id FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,[tenantId,line.itemId,record.location_id]);
      }
      for(const line of lines){
        const [balance]=await m.query(`SELECT average_unit_cost_toman::text AS cost FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,line.itemId,record.location_id]);
        let totalCostToman:string|null=null;
        if(balance.cost!==null){const [cost]=await m.query(`SELECT ROUND($1::numeric*$2::numeric)::bigint::text AS value`,[line.quantityBase,balance.cost]);totalCostToman=cost.value;}
        const movement=await this.postMovement(m,tenantId,actorId,{itemId:line.itemId,locationId:record.location_id,type:InventoryMovementType.Waste,quantity:`-${line.quantityBase}`,reason:`WASTE:${record.reason}`,idempotencyKey:`waste:${id}:${line.id}`,sourceType:"WASTE_RECORD",sourceId:id,sourceLineId:line.id,unitCostToman:balance.cost,totalCostToman});
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
      const lines=await m.query(`SELECT wi.id,wi.item_id AS "itemId",wi.quantity_base::text AS "quantityBase",wi.movement_id AS "movementId",m.quantity_base::text AS "movementQuantity"
        FROM inventory_waste_items wi JOIN inventory_stock_movements m ON m.coffee_shop_id=wi.coffee_shop_id AND m.id=wi.movement_id
        WHERE wi.coffee_shop_id=$1 AND wi.waste_record_id=$2 ORDER BY wi.item_id FOR UPDATE OF wi,m`,[tenantId,id]);
      if(!lines.length)throw new ConflictException("Posted waste movements are unavailable");
      for(const line of lines){
        if(!line.movementQuantity.startsWith("-"))throw new ConflictException("Waste movement has an invalid quantity");
        await this.postMovement(m,tenantId,actorId,{itemId:line.itemId,locationId:record.location_id,type:InventoryMovementType.ManualAdjustment,quantity:line.movementQuantity.slice(1),reason:`WASTE_REVERSAL:${id}`,idempotencyKey:`waste-reversal:${id}:${line.id}`,sourceType:"WASTE_REVERSAL",sourceId:id,sourceLineId:line.id});
      }
      await m.query(`UPDATE inventory_waste_records SET status='REVERSED',reversed_by_user_id=$3,reversed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,actorId]);
    });
    return this.wasteRecord(tenantId,id);
  }

  async createItem(tenantId: string, actorId: string, input: CreateInventoryItemDto) {
    await this.gate(tenantId);
    this.assertUnit(input.dimension,input.baseUnit);
    return this.db.transaction(async (m) => {
      if (input.categoryId) await this.activeCategory(m,tenantId,input.categoryId);
      const locationId = input.locationId ?? (await this.defaultLocation(m,tenantId)).id;
      await this.activeLocation(m,tenantId,locationId);
      const [item] = await m.query(`INSERT INTO inventory_items(coffee_shop_id,name,sku,description,dimension,base_unit,category_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id,name,sku,description,dimension,base_unit AS "baseUnit",category_id AS "categoryId",is_active AS "isActive"`,[tenantId,input.name.trim(),input.sku?.trim() || null,input.description?.trim() || null,input.dimension,input.baseUnit,input.categoryId ?? null]);
      if (input.openingQuantity && input.openingQuantity !== "0") {
        const quantity = quantityToBase(input.openingQuantity,input.dimension,input.baseUnit,input.baseUnit);
        if(quantity!=="0")await this.postMovement(m,tenantId,actorId,{itemId:item.id,locationId,type:InventoryMovementType.OpeningBalance,quantity,reason:"Opening balance",idempotencyKey:`opening:${item.id}`,sourceType:"OPENING_BALANCE",sourceId:item.id});
      }
      return item;
    }).catch(uniqueConflict);
  }
  async updateItem(tenantId: string, id: string, input: UpdateInventoryItemDto) {
    await this.gate(tenantId);
    if (input.categoryId) await this.activeCategory(this.db.manager,tenantId,input.categoryId);
    const rows = await this.db.query(`UPDATE inventory_items SET name=COALESCE($3,name),sku=CASE WHEN $4 THEN $5 ELSE sku END,description=CASE WHEN $6 THEN $7 ELSE description END,category_id=CASE WHEN $8 THEN $9 ELSE category_id END,is_active=COALESCE($10,is_active),updated_at=now() WHERE coffee_shop_id=$1 AND id=$2 RETURNING id,name,sku,description,dimension,base_unit AS "baseUnit",category_id AS "categoryId",is_active AS "isActive"`,[tenantId,id,input.name?.trim() ?? null,input.sku !== undefined,input.sku?.trim() || null,input.description !== undefined,input.description?.trim() || null,input.categoryId !== undefined,input.categoryId ?? null,input.isActive ?? null]).catch(uniqueConflict);
    const row=firstRow(rows);if (!row) throw new NotFoundException("Inventory item not found");
    return row;
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
      return this.postMovement(m,tenantId,actorId,{itemId:item.id,locationId:input.locationId,type:InventoryMovementType.ManualAdjustment,quantity,reason:input.reason.trim(),idempotencyKey:input.idempotencyKey,sourceType:"MANUAL_ADJUSTMENT",sourceId:input.idempotencyKey});
    });
  }

  async movements(tenantId: string, query: MovementListQueryDto) {
    await this.gate(tenantId);
    if(query.from&&query.to&&query.from>query.to)throw new BadRequestException("Start date must be before end date");
    const page=query.page??1,limit=query.limit??50,where=["m.coffee_shop_id=$1"],values:unknown[]=[tenantId];
    const add=(sql:string,v:unknown)=>{values.push(v);where.push(sql.replaceAll("?",`$${values.length}`));};
    if (query.itemId) add("m.item_id=?",query.itemId);
    if (query.locationId) add("m.location_id=?",query.locationId);
    if (query.type) add("m.type=?",query.type);
    if (query.from) add("m.created_at>=?::date",query.from);
    if (query.to) add("m.created_at<?::date+interval '1 day'",query.to);
    if (query.search?.trim()) add("i.name ILIKE '%'||?||'%'",query.search.trim());
    const totals=[...values];values.push(limit,(page-1)*limit);
    const rows=await this.db.query(`SELECT m.id,m.item_id AS "itemId",i.name AS "itemName",m.location_id AS "locationId",l.name AS "locationName",m.type,m.quantity_base::text AS "quantityBase",m.unit_cost_toman::text AS "unitCostToman",m.total_cost_toman AS "totalCostToman",m.reason,m.source_type AS "sourceType",m.source_id AS "sourceId",m.source_line_id AS "sourceLineId",m.order_item_id AS "orderItemId",m.recipe_version_id AS "recipeVersionId",m.recipe_component_id AS "recipeComponentId",m.reversal_of_movement_id AS "reversalOfMovementId",m.actor_user_id AS "actorUserId",m.created_at AS "createdAt" FROM inventory_stock_movements m JOIN inventory_items i ON i.id=m.item_id AND i.coffee_shop_id=m.coffee_shop_id JOIN inventory_locations l ON l.id=m.location_id AND l.coffee_shop_id=m.coffee_shop_id WHERE ${where.join(" AND ")} ORDER BY m.created_at DESC,m.id DESC LIMIT $${values.length-1} OFFSET $${values.length}`,values);
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
    for (const operation of operations) await this.postMovement(manager, tenantId, actorId, {
      ...operation,
      locationId: location.id,
      type: InventoryMovementType.SaleConsumption,
      quantity: `-${operation.quantity}`,
      reason,
      idempotencyKey: `order-consumption:${operation.orderItemId}:${operation.recipeComponentId}`,
      sourceType: "ORDER_CONSUMPTION",
      sourceId: orderId,
    });
    return { applied: true, duplicate: false, skippedItems };
  }

  async reverseOrder(manager: EntityManager, tenantId: string, orderId: string, actorId: string) {
    await this.lockOrder(manager, tenantId, orderId);
    const consumed = await manager.query(`SELECT id,item_id AS "itemId",location_id AS "locationId",quantity_base::text AS quantity,
      unit_cost_toman::text AS "unitCostToman",total_cost_toman::text AS "totalCostToman",
      order_item_id AS "orderItemId",recipe_version_id AS "recipeVersionId",recipe_component_id AS "recipeComponentId"
      FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='ORDER_CONSUMPTION' AND source_id=$2 AND type='SALE_CONSUMPTION'
      ORDER BY item_id,id FOR UPDATE`, [tenantId, orderId]);
    const reason = `بازگشت سفارش #${orderId.slice(0, 8).toUpperCase()}`;
    for (const movement of consumed) {
      if (!movement.quantity.startsWith("-")) throw new ConflictException("An order consumption movement has an invalid quantity");
      await this.postMovement(manager, tenantId, actorId, {
        itemId: movement.itemId,
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
    count.lines=await this.db.query(`SELECT cl.id,cl.item_id AS "itemId",i.name AS "itemName",i.base_unit AS "baseUnit",cl.expected_quantity::text AS "expectedQuantity",cl.counted_quantity::text AS "countedQuantity",cl.variance_quantity::text AS "varianceQuantity" FROM inventory_stock_count_lines cl JOIN inventory_items i ON i.id=cl.item_id AND i.coffee_shop_id=cl.coffee_shop_id WHERE cl.coffee_shop_id=$1 AND cl.count_id=$2 ORDER BY i.name`,[tenantId,id]);
    return count;
  }
  async saveCountLines(tenantId:string,id:string,input:UpdateStockCountLinesDto) {
    await this.gate(tenantId);
    if (new Set(input.lines.map(line=>line.itemId)).size!==input.lines.length) throw new BadRequestException("Duplicate item in stock count");
    await this.db.transaction(async(m)=>{
      const [count]=await m.query(`SELECT * FROM inventory_stock_counts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!count)throw new NotFoundException("Stock count not found");if(count.status!==InventoryCountStatus.Draft)throw new ConflictException("Completed stock counts cannot be changed");
      for(const line of [...input.lines].sort((a,b)=>a.itemId.localeCompare(b.itemId))){
        const item=await this.tenantRow(m,"inventory_items",line.itemId,tenantId);
        if (!item.is_active) throw new ConflictException("Inactive inventory item cannot be counted");
        await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,line.itemId,count.location_id]);
        const [balance]=await m.query(`SELECT quantity_base::text AS quantity_base FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,[tenantId,line.itemId,count.location_id]);
        const counted=quantityToBase(line.countedQuantity,item.dimension,item.base_unit,item.base_unit);
        await m.query(`INSERT INTO inventory_stock_count_lines(coffee_shop_id,count_id,item_id,expected_quantity,counted_quantity,counted_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()) ON CONFLICT(coffee_shop_id,count_id,item_id) DO UPDATE SET expected_quantity=EXCLUDED.expected_quantity,counted_quantity=EXCLUDED.counted_quantity,counted_at=EXCLUDED.counted_at,variance_quantity=NULL`,[tenantId,id,line.itemId,balance.quantity_base,counted]);
      }
    });
    return this.countDetail(tenantId,id);
  }
  async completeCount(tenantId:string,actorId:string,id:string) {
    await this.gate(tenantId);
    await this.db.transaction(async(m)=>{
      const [count]=await m.query(`SELECT * FROM inventory_stock_counts WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
      if(!count)throw new NotFoundException("Stock count not found");if(count.status!==InventoryCountStatus.Draft)throw new ConflictException("Stock count is already completed");
      const lines=await m.query(`SELECT * FROM inventory_stock_count_lines WHERE coffee_shop_id=$1 AND count_id=$2 ORDER BY item_id FOR UPDATE`,[tenantId,id]);
      if(!lines.length)throw new BadRequestException("Add counted items before completing the count");
      for(const line of lines){
        await m.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[tenantId,line.item_id,count.location_id]);
        const [balance]=await m.query(`SELECT quantity_base::text AS quantity_base FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 FOR UPDATE`,[tenantId,line.item_id,count.location_id]);
        const [since]=await m.query(`SELECT COALESCE(sum(quantity_base),0)::text AS quantity FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 AND created_at>$4`,[tenantId,line.item_id,count.location_id,line.counted_at]);
        const variance=addQuantities(line.counted_quantity,`-${line.expected_quantity}`);
        const delta=addQuantities(line.counted_quantity,since.quantity,`-${balance.quantity_base}`);
        let movementId:string|null=null;
        if(delta!=="0"){
          const result=await this.postMovement(m,tenantId,actorId,{itemId:line.item_id,locationId:count.location_id,type:InventoryMovementType.StockCountAdjustment,quantity:delta,reason:`Stock count ${id}`,idempotencyKey:`count:${id}:${line.item_id}`,sourceType:"STOCK_COUNT",sourceId:line.id});
          movementId=result.id;
        }
        await m.query(`UPDATE inventory_stock_count_lines SET variance_quantity=$4,movement_id=$5 WHERE coffee_shop_id=$1 AND count_id=$2 AND item_id=$3`,[tenantId,id,line.item_id,variance,movementId]);
      }
      await m.query(`UPDATE inventory_stock_counts SET status='COMPLETED',completed_by_user_id=$3,completed_at=clock_timestamp(),updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,id,actorId]);
    });
    return this.countDetail(tenantId,id);
  }

  private async normalizeWasteItems(m:EntityManager,tenantId:string,items:CreateWasteRecordDto["items"]){
    if(!items.length)throw new BadRequestException("Add at least one item to a waste record");
    if(new Set(items.map((line)=>line.inventoryItemId)).size!==items.length)throw new BadRequestException("An inventory item can appear only once in a waste record");
    const normalized=[];
    for(const line of items){
      const [item]=await m.query(`SELECT id,name,dimension,base_unit,is_active FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`,[tenantId,line.inventoryItemId]);
      if(!item)throw new NotFoundException("Inventory item not found");
      if(!item.is_active)throw new ConflictException("Inactive inventory items cannot be selected for waste");
      const quantityBase=quantityToBase(line.quantity,item.dimension,line.unit,item.base_unit);
      if(compareQuantities(quantityBase,"0")<=0)throw new BadRequestException("Waste quantity must be greater than zero");
      normalized.push({item,quantity:line.quantity,unit:line.unit,quantityBase});
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
    const [open]=await m.query(`SELECT id,alert_type AS type FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3 AND status='OPEN' FOR UPDATE`,[tenantId,itemId,locationId]);
    if(type===null){
      if(open)await m.query(`UPDATE inventory_stock_alerts SET status='RESOLVED',last_observed_at=clock_timestamp(),resolved_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,open.id]);
    }else if(open){
      await m.query(`UPDATE inventory_stock_alerts SET alert_type=$3,last_observed_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,open.id,type]);
    }else{
      await m.query(`INSERT INTO inventory_stock_alerts(coffee_shop_id,item_id,location_id,alert_type,status,opened_at,last_observed_at) VALUES($1,$2,$3,$4,'OPEN',clock_timestamp(),clock_timestamp()) ON CONFLICT(coffee_shop_id,item_id,location_id) WHERE status='OPEN' DO UPDATE SET alert_type=EXCLUDED.alert_type,last_observed_at=clock_timestamp()`,[tenantId,itemId,locationId,type]);
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
  async postPurchaseReceipt(m:EntityManager,tenantId:string,actorId:string,op:{itemId:string;locationId:string;quantity:string;totalCostToman:string;receiptId:string;lineId:string;reason:string}){
    const [cost] = await m.query(`SELECT ROUND($1::numeric/$2::numeric,6)::text AS unit_cost_toman`, [op.totalCostToman, op.quantity]);
    return this.postMovement(m,tenantId,actorId,{...op,type:InventoryMovementType.PurchaseReceipt,unitCostToman:cost.unit_cost_toman,idempotencyKey:`goods-receipt:${op.receiptId}:${op.lineId}`,sourceType:"GOODS_RECEIPT",sourceId:op.receiptId,sourceLineId:op.lineId});
  }
  private async postMovement(m:EntityManager,tenantId:string,actorId:string|null,op:{itemId:string;locationId:string;type:InventoryMovementType;quantity:string;reason:string;idempotencyKey:string;sourceType:string;sourceId:string;sourceLineId?:string|null;unitCostToman?:string|null;totalCostToman?:string|null;orderItemId?:string|null;recipeVersionId?:string|null;recipeComponentId?:string|null;reversalOfMovementId?:string|null}){
    if(op.type===InventoryMovementType.PurchaseReceipt&&(!op.sourceLineId||!op.unitCostToman||op.totalCostToman===undefined||op.totalCostToman===null))throw new BadRequestException("Purchase receipts require source line and actual cost data");
    const checkPrior=async()=>{
      const [prior]=await m.query(`SELECT id,item_id,location_id,type,quantity_base::text,reason,source_type,source_id,source_line_id,unit_cost_toman::text,total_cost_toman,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND idempotency_key=$2`,[tenantId,op.idempotencyKey]);
      if(!prior)return null;
      const autoCost = op.type === InventoryMovementType.SaleConsumption && op.unitCostToman === undefined && op.totalCostToman === undefined;
      if(prior.item_id!==op.itemId||prior.location_id!==op.locationId||prior.type!==op.type||addQuantities(prior.quantity_base)!==addQuantities(op.quantity)||prior.reason!==op.reason||prior.source_type!==op.sourceType||prior.source_id!==op.sourceId||prior.source_line_id!==(op.sourceLineId??null)||(!autoCost&&(prior.unit_cost_toman!==(op.unitCostToman??null)||prior.total_cost_toman!==(op.totalCostToman??null)))||prior.order_item_id!==(op.orderItemId??null)||prior.recipe_version_id!==(op.recipeVersionId??null)||prior.recipe_component_id!==(op.recipeComponentId??null)||prior.reversal_of_movement_id!==(op.reversalOfMovementId??null))throw new ConflictException("Idempotency key was already used for a different stock operation");
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
    const [movement]=await m.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,unit_cost_toman,total_cost_toman,source_type,source_id,source_line_id,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id,idempotency_key,actor_user_id,reason,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,clock_timestamp())
      ON CONFLICT(coffee_shop_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING RETURNING id`,
    [tenantId,op.itemId,op.locationId,op.type,op.quantity,op.unitCostToman??null,op.totalCostToman??null,op.sourceType,op.sourceId,op.sourceLineId??null,op.orderItemId??null,op.recipeVersionId??null,op.recipeComponentId??null,op.reversalOfMovementId??null,op.idempotencyKey,actorId,op.reason]);
    if(!movement){const duplicate=await checkPrior();if(duplicate)return duplicate;throw new ConflictException("Stock movement could not be recorded");}
    await m.query(`UPDATE inventory_stock_balances SET quantity_base=quantity_base+$4,
      average_unit_cost_toman=CASE WHEN $5='PURCHASE_RECEIPT' THEN CASE WHEN quantity_base<=0 OR average_unit_cost_toman IS NULL THEN $6::numeric ELSE ROUND((quantity_base*average_unit_cost_toman+$7::numeric)/(quantity_base+$4::numeric),6) END ELSE average_unit_cost_toman END,
      updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId,op.quantity,op.type,op.unitCostToman??null,op.totalCostToman??null]);
    const [balance]=await m.query(`SELECT quantity_base::text AS quantity_base FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`,[tenantId,op.itemId,op.locationId]);
    await this.evaluateStockAlert(m,tenantId,op.itemId,op.locationId);
    return {id:movement.id,balance:balance.quantity_base,duplicate:false};
  }
}
