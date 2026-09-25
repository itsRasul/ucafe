import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { InventoryDimension } from "./entities";
import { InventoryService } from "./inventory.service";
import { addQuantities, quantityFromBase, quantityToBase } from "./quantity.util";
import { compareQuantities } from "./stock.util";
import { PurchasingListQueryDto } from "./purchasing.dto";
import { ReplenishmentQueryDto, SupplierItemPreferenceDto, SupplierPriceHistoryQueryDto } from "./smart-purchasing.dto";

const SCALE = 1_000_000n;
type ReplenishmentExtra = {
  itemId: string;
  locationId: string;
  preferredSupplierId: string | null;
  preferredSupplierName: string | null;
  preferredSupplierActive: boolean | null;
  preferredPurchaseUnit: string | null;
  minimumOrderQuantityBase: string | null;
  lastPurchaseUnit: string | null;
  lastPurchasePurchaseUnits: string | null;
  lastPurchaseQuantity: string | null;
  lastPurchaseNormalizedPriceTomanPerBaseUnit: string | null;
  lastPurchaseReceiptNumber: string | null;
  lastPurchaseDate: string | Date | null;
  latestNormalizedPriceTomanPerBaseUnit: string | null;
  previousNormalizedPriceTomanPerBaseUnit: string | null;
  priceChangePercent: string | null;
  expiredBatchQuantityBase: string;
  expiringSoonBatchQuantityBase: string;
  hasDraftPurchaseOrder: boolean;
};

function scaled(value: string): bigint {
  const match = /^(\d{1,18})(?:\.(\d{1,6}))?$/.exec(value);
  if (!match) throw new BadRequestException("Invalid normalized price or quantity");
  return BigInt(match[1]!) * SCALE + BigInt((match[2] ?? "").padEnd(6, "0") || "0");
}

export function estimatePurchaseCostToman(pricePerBaseUnit: string, quantityBase: string): string {
  const total = scaled(pricePerBaseUnit) * scaled(quantityBase);
  return ((total + (SCALE * SCALE) / 2n) / (SCALE * SCALE)).toString();
}

@Injectable()
export class SmartPurchasingService {
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService, private readonly inventory: InventoryService) {}
  private async gate(tenantId: string) { await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory); }

  async replenishment(tenantId: string, query: ReplenishmentQueryDto) {
    await this.gate(tenantId);
    const page = await this.inventory.stock(tenantId, { ...query, active: "true" });
    if (!page.items.length) return page;
    const itemIds = page.items.map((row: Record<string, string>) => row.itemId);
    const locationIds = page.items.map((row: Record<string, string>) => row.locationId);
    const enrichment = await this.db.query(`WITH selected AS (
        SELECT DISTINCT item_id,location_id FROM unnest($2::uuid[],$3::uuid[]) AS x(item_id,location_id)
      ), selected_items AS (SELECT DISTINCT item_id FROM selected),
      prefs AS (
        SELECT si.inventory_item_id AS item_id,si.supplier_id,si.preferred_purchase_unit,si.minimum_order_quantity_base::text AS minimum_order_quantity_base,si.is_preferred,s.name AS supplier_name,s.is_active AS supplier_active
        FROM inventory_supplier_items si JOIN inventory_suppliers s ON s.coffee_shop_id=si.coffee_shop_id AND s.id=si.supplier_id
        JOIN selected_items x ON x.item_id=si.inventory_item_id
        WHERE si.coffee_shop_id=$1 AND si.is_preferred
      ), prices AS (
        SELECT p.item_id,p.supplier_id,i.base_unit AS unit,string_agg(DISTINCT l.unit,', ' ORDER BY l.unit) AS purchase_units,sum(l.quantity_base)::text AS quantity,
          g.number AS receipt_number,COALESCE(g.received_at,g.posted_at) AS received_at,
          round(sum(l.total_cost_toman)::numeric/sum(l.quantity_base),6)::text AS normalized_price,
          row_number() OVER(PARTITION BY p.item_id,p.supplier_id ORDER BY COALESCE(g.received_at,g.posted_at) DESC,g.id DESC) AS rank
        FROM prefs p JOIN inventory_goods_receipts g ON g.coffee_shop_id=$1 AND g.supplier_id=p.supplier_id AND g.status='POSTED'
        JOIN inventory_goods_receipt_lines l ON l.coffee_shop_id=g.coffee_shop_id AND l.goods_receipt_id=g.id AND l.inventory_item_id=p.item_id
        JOIN inventory_items i ON i.coffee_shop_id=l.coffee_shop_id AND i.id=l.inventory_item_id
        GROUP BY p.item_id,p.supplier_id,i.base_unit,g.id,g.number,g.received_at,g.posted_at
      ), expiry AS (
        SELECT x.item_id,x.location_id,
          COALESCE(sum(b.remaining_quantity_base) FILTER (WHERE b.expiry_date < (now() AT TIME ZONE 'Asia/Tehran')::date),0)::text AS expired_quantity_base,
          COALESCE(sum(b.remaining_quantity_base) FILTER (WHERE b.expiry_date >= (now() AT TIME ZONE 'Asia/Tehran')::date AND b.expiry_date <= (now() AT TIME ZONE 'Asia/Tehran')::date+i.expiry_warning_days),0)::text AS expiring_soon_quantity_base
        FROM selected x JOIN inventory_items i ON i.coffee_shop_id=$1 AND i.id=x.item_id AND i.batch_tracking_enabled
        LEFT JOIN inventory_batches b ON b.coffee_shop_id=$1 AND b.item_id=x.item_id AND b.location_id=x.location_id AND b.remaining_quantity_base>0 AND b.expiry_date IS NOT NULL
        GROUP BY x.item_id,x.location_id,i.expiry_warning_days
      ), drafts AS (
        SELECT DISTINCT oi.inventory_item_id AS item_id FROM inventory_purchase_order_items oi
        JOIN inventory_purchase_orders po ON po.coffee_shop_id=oi.coffee_shop_id AND po.id=oi.purchase_order_id AND po.status='DRAFT'
        JOIN selected_items x ON x.item_id=oi.inventory_item_id WHERE oi.coffee_shop_id=$1
      )
      SELECT x.item_id AS "itemId",x.location_id AS "locationId",p.supplier_id AS "preferredSupplierId",p.supplier_name AS "preferredSupplierName",
        p.supplier_active AS "preferredSupplierActive",p.preferred_purchase_unit AS "preferredPurchaseUnit",p.minimum_order_quantity_base AS "minimumOrderQuantityBase",
        latest.unit AS "lastPurchaseUnit",latest.purchase_units AS "lastPurchasePurchaseUnits",latest.quantity AS "lastPurchaseQuantity",latest.normalized_price AS "lastPurchaseNormalizedPriceTomanPerBaseUnit",
        latest.receipt_number AS "lastPurchaseReceiptNumber",latest.received_at AS "lastPurchaseDate",latest.normalized_price AS "latestNormalizedPriceTomanPerBaseUnit",
        previous.normalized_price AS "previousNormalizedPriceTomanPerBaseUnit",
        CASE WHEN previous.normalized_price IS NULL OR previous.normalized_price::numeric=0 THEN NULL ELSE round((latest.normalized_price::numeric-previous.normalized_price::numeric)/previous.normalized_price::numeric*100,2)::text END AS "priceChangePercent",
        COALESCE(e.expired_quantity_base,'0') AS "expiredBatchQuantityBase",COALESCE(e.expiring_soon_quantity_base,'0') AS "expiringSoonBatchQuantityBase",
        EXISTS(SELECT 1 FROM drafts d WHERE d.item_id=x.item_id) AS "hasDraftPurchaseOrder"
      FROM selected x LEFT JOIN prefs p ON p.item_id=x.item_id
      LEFT JOIN prices latest ON latest.item_id=x.item_id AND latest.supplier_id=p.supplier_id AND latest.rank=1
      LEFT JOIN prices previous ON previous.item_id=x.item_id AND previous.supplier_id=p.supplier_id AND previous.rank=2
      LEFT JOIN expiry e ON e.item_id=x.item_id AND e.location_id=x.location_id`, [tenantId,itemIds,locationIds]);
    const byKey = new Map<string,ReplenishmentExtra>(enrichment.map((row:ReplenishmentExtra)=>[`${row.itemId}:${row.locationId}`,row]));
    const items = page.items.map((row: Record<string, string | null>) => {
      const extra = byKey.get(`${row.itemId}:${row.locationId}`) ?? {
        itemId:row.itemId!,locationId:row.locationId!,preferredSupplierId:null,preferredSupplierName:null,preferredSupplierActive:null,preferredPurchaseUnit:null,
        minimumOrderQuantityBase:null,lastPurchaseUnit:null,lastPurchasePurchaseUnits:null,lastPurchaseQuantity:null,lastPurchaseNormalizedPriceTomanPerBaseUnit:null,lastPurchaseReceiptNumber:null,lastPurchaseDate:null,
        latestNormalizedPriceTomanPerBaseUnit:null,previousNormalizedPriceTomanPerBaseUnit:null,priceChangePercent:null,expiredBatchQuantityBase:"0",expiringSoonBatchQuantityBase:"0",hasDraftPurchaseOrder:false,
      };
      const dimension = row.dimension as InventoryDimension, baseUnit = row.baseUnit!;
      const expired = extra.expiredBatchQuantityBase ?? "0";
      const available = addQuantities(row.quantityBase!, `-${expired}`);
      const projected = addQuantities(available, row.onOrderQuantityBase!);
      const gap = row.parQuantityBase === null ? null : compareQuantities(row.parQuantityBase!, projected) > 0 ? addQuantities(row.parQuantityBase!, `-${projected}`) : "0";
      const purchaseUnit = extra.preferredPurchaseUnit ?? row.unit!;
      let suggestedBase = gap ?? "0";
      if (gap && compareQuantities(gap,"0")>0 && extra.minimumOrderQuantityBase && compareQuantities(extra.minimumOrderQuantityBase,gap)>0) suggestedBase=extra.minimumOrderQuantityBase;
      const warnings: string[] = [];
      if (row.parQuantityBase === null) warnings.push("TARGET_NOT_CONFIGURED");
      if (gap === "0") warnings.push("TARGET_COVERED");
      if (compareQuantities(expired,"0")>0) warnings.push("EXPIRED_STOCK_EXCLUDED");
      if (compareQuantities(extra.expiringSoonBatchQuantityBase ?? "0","0")>0) warnings.push("BATCH_EXPIRING_SOON");
      if (extra.hasDraftPurchaseOrder) warnings.push("DRAFT_PURCHASE_ORDER_EXISTS");
      if (!extra.preferredSupplierId) warnings.push("NO_PREFERRED_SUPPLIER");
      else if (!extra.preferredSupplierActive) warnings.push("PREFERRED_SUPPLIER_INACTIVE");
      if (extra.preferredSupplierId && !extra.latestNormalizedPriceTomanPerBaseUnit) warnings.push("NO_RECORDED_PRICE");
      if (gap && extra.minimumOrderQuantityBase && compareQuantities(suggestedBase,gap)>0) warnings.push("SUPPLIER_MINIMUM_APPLIED");
      return {
        ...row,
        expiredBatchQuantity: quantityFromBase(expired,dimension,baseUnit,baseUnit),
        expiringSoonBatchQuantity: quantityFromBase(extra.expiringSoonBatchQuantityBase ?? "0",dimension,baseUnit,baseUnit),
        usableQuantityBase: available,
        usableQuantity: quantityFromBase(available,dimension,row.unit!,baseUnit),
        usableProjectedQuantityBase: projected,
        usableProjectedQuantity: quantityFromBase(projected,dimension,row.unit!,baseUnit),
        replenishmentGapBase: gap,
        replenishmentGap: gap === null ? null : quantityFromBase(gap,dimension,row.unit!,baseUnit),
        suggestedPurchaseQuantityBase: row.parQuantityBase === null ? null : suggestedBase,
        suggestedPurchaseQuantity: row.parQuantityBase === null ? null : quantityFromBase(suggestedBase,dimension,purchaseUnit,baseUnit),
        suggestedPurchaseUnit: purchaseUnit,
        preferredSupplier: extra.preferredSupplierId ? { id: extra.preferredSupplierId, name: extra.preferredSupplierName, isActive: extra.preferredSupplierActive } : null,
        minimumOrderQuantity: extra.minimumOrderQuantityBase ? quantityFromBase(extra.minimumOrderQuantityBase,dimension,purchaseUnit,baseUnit) : null,
        lastPurchase: extra.lastPurchaseDate ? { quantity: extra.lastPurchaseQuantity, unit: extra.lastPurchaseUnit, purchaseUnits: extra.lastPurchasePurchaseUnits, normalizedPriceTomanPerBaseUnit: extra.lastPurchaseNormalizedPriceTomanPerBaseUnit, receiptNumber: extra.lastPurchaseReceiptNumber, receivedAt: extra.lastPurchaseDate } : null,
        latestNormalizedPriceTomanPerBaseUnit: extra.latestNormalizedPriceTomanPerBaseUnit ?? null,
        previousNormalizedPriceTomanPerBaseUnit: extra.previousNormalizedPriceTomanPerBaseUnit ?? null,
        priceChangePercent: extra.priceChangePercent ?? null,
        estimatedPurchaseCostToman: extra.preferredSupplierActive && extra.latestNormalizedPriceTomanPerBaseUnit && gap && compareQuantities(gap,"0")>0 ? estimatePurchaseCostToman(extra.latestNormalizedPriceTomanPerBaseUnit,suggestedBase) : null,
        estimatedUnitPriceToman: extra.preferredSupplierActive && extra.latestNormalizedPriceTomanPerBaseUnit ? estimatePurchaseCostToman(extra.latestNormalizedPriceTomanPerBaseUnit,quantityToBase("1",dimension,purchaseUnit,baseUnit)) : null,
        hasDraftPurchaseOrder: Boolean(extra.hasDraftPurchaseOrder),
        dataWarnings: warnings,
      };
    });
    return { ...page, items };
  }

  async supplierPrices(tenantId: string, itemId: string, query: PurchasingListQueryDto) {
    await this.gate(tenantId);
    const [item] = await this.db.query(`SELECT id,name,dimension,base_unit AS "baseUnit",is_active AS "isActive" FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,itemId]);
    if (!item) throw new NotFoundException("Inventory item not found");
    const page=query.page??1,limit=query.limit??50;
    const [{count}] = await this.db.query(`SELECT count(*)::int AS count FROM inventory_suppliers WHERE coffee_shop_id=$1`,[tenantId]);
    const rows=await this.db.query(`WITH supplier_page AS (
        SELECT id,name,is_active FROM inventory_suppliers WHERE coffee_shop_id=$1 ORDER BY is_active DESC,name,id LIMIT $3 OFFSET $4
      ), prices AS (
        SELECT g.supplier_id,i.base_unit AS unit,
          CASE WHEN count(DISTINCT l.unit)=1 THEN min(l.unit) ELSE i.base_unit END AS purchase_unit,
          string_agg(DISTINCT l.unit,', ' ORDER BY l.unit) AS purchase_units,sum(l.quantity_base)::text AS quantity,
          g.number AS "receiptNumber",COALESCE(g.received_at,g.posted_at) AS "receivedAt",
          sum(l.total_cost_toman)::text AS "totalCostToman",
          round(sum(l.total_cost_toman)::numeric/sum(l.quantity_base),6)::text AS "normalizedPrice",
          row_number() OVER(PARTITION BY g.supplier_id ORDER BY COALESCE(g.received_at,g.posted_at) DESC,g.id DESC) AS rank
        FROM inventory_goods_receipts g JOIN inventory_goods_receipt_lines l ON l.coffee_shop_id=g.coffee_shop_id AND l.goods_receipt_id=g.id
        JOIN inventory_items i ON i.coffee_shop_id=l.coffee_shop_id AND i.id=l.inventory_item_id
        WHERE g.coffee_shop_id=$1 AND l.inventory_item_id=$2 AND g.status='POSTED'
        GROUP BY g.supplier_id,i.base_unit,g.id,g.number,g.received_at,g.posted_at
      )
      SELECT s.id AS "supplierId",s.name AS "supplierName",s.is_active AS "supplierIsActive",p.preferred_purchase_unit AS "preferredPurchaseUnit",
        p.minimum_order_quantity_base::text AS "minimumOrderQuantityBase",COALESCE(p.is_preferred,false) AS preferred,
        latest.quantity AS "latestQuantity",latest.purchase_unit AS "latestUnit",latest.purchase_units AS "latestPurchaseUnits",latest."receiptNumber" AS "latestReceiptNumber",latest."receivedAt" AS "latestPurchaseDate",latest."normalizedPrice" AS "latestNormalizedPriceTomanPerBaseUnit",
        previous.quantity AS "previousQuantity",previous.unit AS "previousUnit",previous."receiptNumber" AS "previousReceiptNumber",previous."receivedAt" AS "previousPurchaseDate",previous."normalizedPrice" AS "previousNormalizedPriceTomanPerBaseUnit",
        CASE WHEN previous."normalizedPrice" IS NULL OR previous."normalizedPrice"::numeric=0 THEN NULL ELSE round((latest."normalizedPrice"::numeric-previous."normalizedPrice"::numeric)/previous."normalizedPrice"::numeric*100,2)::text END AS "priceChangePercent"
      FROM supplier_page s LEFT JOIN inventory_supplier_items p ON p.coffee_shop_id=$1 AND p.supplier_id=s.id AND p.inventory_item_id=$2
      LEFT JOIN prices latest ON latest.supplier_id=s.id AND latest.rank=1 LEFT JOIN prices previous ON previous.supplier_id=s.id AND previous.rank=2
      ORDER BY s.is_active DESC,s.name,s.id`,[tenantId,itemId,limit,(page-1)*limit]);
    const items=rows.map((row:Record<string,string|null>)=>({
      ...row,
      minimumOrderQuantity:row.minimumOrderQuantityBase?quantityFromBase(row.minimumOrderQuantityBase,item.dimension as InventoryDimension,row.preferredPurchaseUnit??item.baseUnit,item.baseUnit):null,
    }));
    return {item:{id:item.id,name:item.name,isActive:item.isActive,dimension:item.dimension,baseUnit:item.baseUnit},items,page,limit,total:count};
  }

  async supplierPriceHistory(tenantId: string,itemId:string,query:SupplierPriceHistoryQueryDto){
    await this.gate(tenantId);
    const [item]=await this.db.query(`SELECT id FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,itemId]);
    if(!item)throw new NotFoundException("Inventory item not found");
    const [supplier]=await this.db.query(`SELECT id FROM inventory_suppliers WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,query.supplierId]);
    if(!supplier)throw new NotFoundException("Supplier not found");
    const page=query.page??1,limit=query.limit??50;
    const [{count}]=await this.db.query(`SELECT count(DISTINCT g.id)::int AS count FROM inventory_goods_receipt_lines l JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id WHERE g.coffee_shop_id=$1 AND l.inventory_item_id=$2 AND g.supplier_id=$3 AND g.status='POSTED'`,[tenantId,itemId,query.supplierId]);
    const items=await this.db.query(`SELECT g.number AS "receiptNumber",COALESCE(g.received_at,g.posted_at) AS "receivedAt",sum(l.quantity_base)::text AS quantity,i.base_unit AS unit,string_agg(DISTINCT l.unit,', ' ORDER BY l.unit) AS "purchaseUnits",sum(l.total_cost_toman)::text AS "totalCostToman",round(sum(l.total_cost_toman)::numeric/sum(l.quantity_base),6)::text AS "normalizedPriceTomanPerBaseUnit"
      FROM inventory_goods_receipt_lines l JOIN inventory_goods_receipts g ON g.coffee_shop_id=l.coffee_shop_id AND g.id=l.goods_receipt_id
      JOIN inventory_items i ON i.coffee_shop_id=l.coffee_shop_id AND i.id=l.inventory_item_id
      WHERE g.coffee_shop_id=$1 AND l.inventory_item_id=$2 AND g.supplier_id=$3 AND g.status='POSTED'
      GROUP BY g.id,g.number,g.received_at,g.posted_at,i.base_unit
      ORDER BY COALESCE(g.received_at,g.posted_at) DESC,g.id DESC LIMIT $4 OFFSET $5`,[tenantId,itemId,query.supplierId,limit,(page-1)*limit]);
    return {items,page,limit,total:count};
  }

  async saveSupplierItemPreference(tenantId:string,supplierId:string,itemId:string,input:SupplierItemPreferenceDto){
    await this.gate(tenantId);
    if(input.isPreferred===undefined&&input.purchaseUnit===undefined&&input.minimumOrderQuantity===undefined)throw new BadRequestException("At least one supplier preference field is required");
    return this.db.transaction(async(manager:EntityManager)=>{
      const [item]=await manager.query(`SELECT id,dimension,base_unit AS "baseUnit" FROM inventory_items WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`,[tenantId,itemId]);
      if(!item)throw new NotFoundException("Inventory item not found");
      const [supplier]=await manager.query(`SELECT id,is_active AS "isActive" FROM inventory_suppliers WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`,[tenantId,supplierId]);
      if(!supplier)throw new NotFoundException("Supplier not found");
      const [current]=await manager.query(`SELECT preferred_purchase_unit AS "purchaseUnit",minimum_order_quantity_base::text AS "minimumOrderQuantityBase",is_preferred AS "isPreferred" FROM inventory_supplier_items WHERE coffee_shop_id=$1 AND supplier_id=$2 AND inventory_item_id=$3 FOR UPDATE`,[tenantId,supplierId,itemId]);
      const purchaseUnit=input.purchaseUnit===undefined?current?.purchaseUnit??null:input.purchaseUnit;
      const isPreferred=input.isPreferred??current?.isPreferred??false;
      if(isPreferred&&!supplier.isActive)throw new ConflictException("An inactive supplier cannot be preferred for new orders");
      let minimumBase=current?.minimumOrderQuantityBase??null;
      if(input.minimumOrderQuantity!==undefined){
        if(input.minimumOrderQuantity===null)minimumBase=null;
        else{
          const unit=purchaseUnit??item.baseUnit;
          minimumBase=quantityToBase(input.minimumOrderQuantity,item.dimension as InventoryDimension,unit,item.baseUnit);
          if(compareQuantities(minimumBase,"0")<=0)throw new BadRequestException("Minimum order quantity must be greater than zero");
        }
      } else if(purchaseUnit===null&&minimumBase!==null){
        throw new BadRequestException("A purchase unit is required while a minimum order quantity is configured");
      }
      if(purchaseUnit!==null)quantityToBase("1",item.dimension as InventoryDimension,purchaseUnit,item.baseUnit);
      if(isPreferred)await manager.query(`UPDATE inventory_supplier_items SET is_preferred=false,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND inventory_item_id=$2 AND is_preferred AND supplier_id<>$3`,[tenantId,itemId,supplierId]);
      const [saved]=await manager.query(`INSERT INTO inventory_supplier_items(coffee_shop_id,supplier_id,inventory_item_id,preferred_purchase_unit,minimum_order_quantity_base,is_preferred)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(coffee_shop_id,supplier_id,inventory_item_id) DO UPDATE SET preferred_purchase_unit=EXCLUDED.preferred_purchase_unit,minimum_order_quantity_base=EXCLUDED.minimum_order_quantity_base,is_preferred=EXCLUDED.is_preferred,updated_at=clock_timestamp()
        RETURNING supplier_id AS "supplierId",inventory_item_id AS "inventoryItemId",preferred_purchase_unit AS "purchaseUnit",minimum_order_quantity_base::text AS "minimumOrderQuantityBase",is_preferred AS "isPreferred"`,[tenantId,supplierId,itemId,purchaseUnit,minimumBase,isPreferred]);
      return {...saved,minimumOrderQuantity:saved.minimumOrderQuantityBase?quantityFromBase(saved.minimumOrderQuantityBase,item.dimension as InventoryDimension,purchaseUnit??item.baseUnit,item.baseUnit):null};
    });
  }
}
