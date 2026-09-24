import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { InventoryVarianceIntervalDto, InventoryVarianceQueryDto } from "./variance.dto";

export const INVENTORY_VARIANCE_MOVEMENT_TYPES = {
  PHYSICAL_INBOUND: ["PURCHASE_RECEIPT", "TRANSFER_IN", "PRODUCTION_OUTPUT"],
  PHYSICAL_OUTBOUND: ["TRANSFER_OUT"],
  THEORETICAL_SALE_USAGE: ["SALE_CONSUMPTION", "SALE_REVERSAL"],
  OTHER_EXPLAINED_CONSUMPTION: ["PRODUCTION_CONSUMPTION"],
} as const;

export type InventoryVarianceMovementClass =
  | "PHYSICAL_INBOUND" | "PHYSICAL_OUTBOUND_NON_USAGE" | "THEORETICAL_SALE_USAGE"
  | "KNOWN_WASTE" | "OTHER_EXPLAINED_CONSUMPTION" | "RECONCILIATION"
  | "AMBIGUOUS_ADJUSTMENT" | "OPENING_BALANCE" | "IGNORED_FOR_VARIANCE";

export function classifyInventoryVarianceMovement(type: string, sourceType: string | null): InventoryVarianceMovementClass {
  if (INVENTORY_VARIANCE_MOVEMENT_TYPES.PHYSICAL_INBOUND.some((value) => value === type)) return "PHYSICAL_INBOUND";
  if (INVENTORY_VARIANCE_MOVEMENT_TYPES.PHYSICAL_OUTBOUND.some((value) => value === type)) return "PHYSICAL_OUTBOUND_NON_USAGE";
  if (INVENTORY_VARIANCE_MOVEMENT_TYPES.THEORETICAL_SALE_USAGE.some((value) => value === type)) return "THEORETICAL_SALE_USAGE";
  if (INVENTORY_VARIANCE_MOVEMENT_TYPES.OTHER_EXPLAINED_CONSUMPTION.some((value) => value === type)) return "OTHER_EXPLAINED_CONSUMPTION";
  if (type === "WASTE" || (type === "MANUAL_ADJUSTMENT" && sourceType === "WASTE_REVERSAL")) return "KNOWN_WASTE";
  if (type === "STOCK_COUNT_ADJUSTMENT") return "RECONCILIATION";
  if (type === "MANUAL_ADJUSTMENT") return "AMBIGUOUS_ADJUSTMENT";
  if (type === "OPENING_BALANCE") return "OPENING_BALANCE";
  return "IGNORED_FOR_VARIANCE";
}

interface CountRow {
  id: string;
  locationId: string;
  locationName: string;
  status: string;
  completedAt: Date | string | null;
}

const EFFECTIVE_AT = `CASE
  WHEN m.type='PURCHASE_RECEIPT' AND m.source_type='GOODS_RECEIPT' THEN COALESCE(gr.received_at,m.created_at)
  WHEN m.type='WASTE' AND m.source_type='WASTE_RECORD' THEN COALESCE(w.wasted_at,m.created_at)
  ELSE m.created_at END`;
const SOURCE_JOINS = `
  LEFT JOIN inventory_goods_receipts gr ON m.source_type='GOODS_RECEIPT' AND gr.coffee_shop_id=m.coffee_shop_id AND gr.id::text=m.source_id
  LEFT JOIN inventory_batches movement_batch ON movement_batch.coffee_shop_id=m.coffee_shop_id AND movement_batch.id=m.batch_id
  LEFT JOIN inventory_goods_receipt_lines grl ON grl.coffee_shop_id=m.coffee_shop_id AND grl.goods_receipt_id=gr.id
    AND grl.inventory_item_id=m.item_id AND grl.location_id=m.location_id AND ((m.batch_id IS NULL AND grl.movement_id=m.id AND grl.quantity_base=m.quantity_base) OR
      (m.batch_id IS NOT NULL AND movement_batch.goods_receipt_id=gr.id AND movement_batch.goods_receipt_line_id=grl.id AND movement_batch.original_quantity_base=m.quantity_base AND m.source_line_id=grl.id::text||':'||movement_batch.id::text))
  LEFT JOIN inventory_waste_records w ON m.source_type IN ('WASTE_RECORD','WASTE_REVERSAL') AND w.coffee_shop_id=m.coffee_shop_id AND w.id::text=m.source_id
  LEFT JOIN inventory_waste_items wi ON wi.coffee_shop_id=m.coffee_shop_id AND wi.waste_record_id=w.id AND wi.id::text=m.source_line_id AND wi.item_id=m.item_id
    AND ((m.type='WASTE' AND wi.movement_id=m.id AND wi.quantity_base=-m.quantity_base AND wi.batch_id IS NOT DISTINCT FROM m.batch_id) OR (m.source_type='WASTE_REVERSAL' AND wi.quantity_base=m.quantity_base AND wi.batch_id IS NOT DISTINCT FROM m.batch_id))
  LEFT JOIN order_items sale_item ON m.type IN ('SALE_CONSUMPTION','SALE_REVERSAL') AND sale_item.coffee_shop_id=m.coffee_shop_id AND sale_item.id=m.order_item_id
  LEFT JOIN orders sale_order ON sale_order.coffee_shop_id=sale_item.coffee_shop_id AND sale_order.id=sale_item.order_id AND sale_order.id::text=m.source_id
  LEFT JOIN inventory_stock_movements original ON m.type='SALE_REVERSAL' AND original.coffee_shop_id=m.coffee_shop_id AND original.id=m.reversal_of_movement_id
  LEFT JOIN inventory_recipe_components sale_component ON sale_component.coffee_shop_id=m.coffee_shop_id AND sale_component.id=m.recipe_component_id
    AND sale_component.recipe_version_id=m.recipe_version_id AND sale_component.inventory_item_id=m.item_id
    AND sale_item.id IS NOT NULL AND sale_component.quantity_base*sale_item.quantity=CASE WHEN m.type='SALE_REVERSAL' THEN -original.quantity_base ELSE -m.quantity_base END`;
const SOURCE_VALID = `CASE
  WHEN m.type='PURCHASE_RECEIPT' THEN m.source_type='GOODS_RECEIPT' AND gr.status='POSTED' AND grl.id IS NOT NULL
  WHEN m.type='SALE_CONSUMPTION' THEN m.source_type='ORDER_CONSUMPTION' AND m.quantity_base<0 AND m.recipe_version_id IS NOT NULL
    AND m.recipe_component_id IS NOT NULL AND sale_item.id IS NOT NULL AND sale_order.id IS NOT NULL AND sale_component.id IS NOT NULL
  WHEN m.type='SALE_REVERSAL' THEN m.source_type='ORDER_REVERSAL' AND original.type='SALE_CONSUMPTION'
    AND original.source_type='ORDER_CONSUMPTION' AND original.source_id=m.source_id AND original.order_item_id=m.order_item_id
    AND original.recipe_version_id=m.recipe_version_id AND original.recipe_component_id=m.recipe_component_id AND original.batch_id IS NOT DISTINCT FROM m.batch_id
    AND sale_item.id IS NOT NULL AND sale_order.id IS NOT NULL AND sale_component.id IS NOT NULL
  WHEN m.type='WASTE' THEN m.source_type='WASTE_RECORD' AND w.status IN ('POSTED','REVERSED') AND wi.id IS NOT NULL
  WHEN m.source_type='WASTE_REVERSAL' THEN m.type='MANUAL_ADJUSTMENT' AND w.status='REVERSED' AND wi.id IS NOT NULL
  ELSE TRUE END`;

@Injectable()
export class InventoryVarianceService {
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private async gate(tenantId: string) {
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory);
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Analytics);
  }

  async countOptions(tenantId: string) {
    await this.gate(tenantId);
    const [locations, counts] = await Promise.all([
      this.db.query(`SELECT id,name,is_default AS "isDefault",is_active AS "isActive" FROM inventory_locations WHERE coffee_shop_id=$1 ORDER BY is_default DESC,name`, [tenantId]),
      this.db.query(`SELECT c.id,c.location_id AS "locationId",l.name AS "locationName",c.completed_at AS "completedAt",
          count(cl.id)::int AS "itemCount"
        FROM inventory_stock_counts c JOIN inventory_locations l ON l.coffee_shop_id=c.coffee_shop_id AND l.id=c.location_id
        LEFT JOIN inventory_stock_count_lines cl ON cl.coffee_shop_id=c.coffee_shop_id AND cl.count_id=c.id
        WHERE c.coffee_shop_id=$1 AND c.status='COMPLETED'
        GROUP BY c.id,l.name ORDER BY c.completed_at DESC,c.id DESC LIMIT 100`, [tenantId]),
    ]);
    return { locations, counts, countLimit: 100 };
  }

  private async interval(tenantId: string, query: InventoryVarianceIntervalDto) {
    if (query.openingCountId === query.closingCountId) throw new BadRequestException("Opening and closing counts must be different");
    const rows = await this.db.query<CountRow[]>(`SELECT c.id,c.location_id AS "locationId",l.name AS "locationName",c.status,c.completed_at AS "completedAt"
      FROM inventory_stock_counts c JOIN inventory_locations l ON l.coffee_shop_id=c.coffee_shop_id AND l.id=c.location_id
      WHERE c.coffee_shop_id=$1 AND c.id=ANY($2::uuid[])`, [tenantId, [query.openingCountId, query.closingCountId]]);
    const opening = rows.find((row) => row.id === query.openingCountId);
    const closing = rows.find((row) => row.id === query.closingCountId);
    if (!opening || !closing) throw new NotFoundException("Completed stock count not found");
    if (opening.status !== "COMPLETED" || closing.status !== "COMPLETED") throw new BadRequestException("Both stock counts must be completed");
    if (opening.locationId !== closing.locationId || opening.locationId !== query.locationId) throw new BadRequestException("Both counts must belong to the selected location");
    if (new Date(closing.completedAt!).getTime() <= new Date(opening.completedAt!).getTime()) throw new BadRequestException("Closing count must follow opening count");
    return { opening, closing };
  }

  async report(tenantId: string, query: InventoryVarianceIntervalDto & Partial<InventoryVarianceQueryDto>) {
    return this.calculate(tenantId, query, null);
  }

  async item(tenantId: string, itemId: string, query: InventoryVarianceIntervalDto) {
    const result = await this.calculate(tenantId, query, itemId);
    const row = result.items[0];
    if (!row) throw new NotFoundException("Inventory item not found");
    const movements = await this.db.query(`SELECT m.type,m.quantity_base::text AS "quantityBase",m.reason,m.source_type AS "sourceType",${SOURCE_VALID} AS "sourceValid",
        m.created_at AS "recordedAt",${EFFECTIVE_AT} AS "effectiveAt",
        CASE WHEN gr.id IS NOT NULL THEN gr.number
          WHEN sale_order.id IS NOT NULL THEN 'سفارش #'||upper(left(sale_order.id::text,8))
          WHEN w.id IS NOT NULL THEN CASE WHEN m.source_type='WASTE_REVERSAL' THEN 'اصلاح ضایعات' ELSE 'ضایعات '||w.reason::text END
          WHEN m.type='STOCK_COUNT_ADJUSTMENT' THEN 'اصلاح شمارش'
          ELSE NULL END AS "sourceReference",
        CASE WHEN gr.id IS NOT NULL THEN 'Goods Receipt' WHEN sale_order.id IS NOT NULL THEN 'Order'
          WHEN w.id IS NOT NULL THEN 'Waste' WHEN m.type='STOCK_COUNT_ADJUSTMENT' THEN 'Stock Count' ELSE m.source_type END AS "sourceLabel"
      FROM inventory_stock_movements m
      JOIN LATERAL (SELECT max(counted_at) AS counted_at FROM inventory_stock_count_lines WHERE coffee_shop_id=m.coffee_shop_id AND count_id=$3 AND item_id=m.item_id) opening_line ON opening_line.counted_at IS NOT NULL
      JOIN LATERAL (SELECT max(counted_at) AS counted_at FROM inventory_stock_count_lines WHERE coffee_shop_id=m.coffee_shop_id AND count_id=$4 AND item_id=m.item_id) closing_line ON closing_line.counted_at IS NOT NULL
      ${SOURCE_JOINS}
      WHERE m.coffee_shop_id=$1 AND m.location_id=$2 AND m.item_id=$5
        AND ${EFFECTIVE_AT}>opening_line.counted_at AND ${EFFECTIVE_AT}<=closing_line.counted_at
      ORDER BY ${EFFECTIVE_AT},m.id`, [tenantId, query.locationId, query.openingCountId, query.closingCountId, itemId]);
    const [closingAdjustment] = await this.db.query(`SELECT 'STOCK_COUNT_ADJUSTMENT' AS type,sum(m.quantity_base)::text AS "quantityBase",max(m.created_at) AS "recordedAt"
      FROM inventory_stock_count_lines cl JOIN inventory_stock_movements m ON m.coffee_shop_id=cl.coffee_shop_id AND m.id=cl.movement_id
      WHERE cl.coffee_shop_id=$1 AND cl.count_id=$2 AND cl.item_id=$3 AND m.type='STOCK_COUNT_ADJUSTMENT' HAVING count(*)>0`, [tenantId, query.closingCountId, itemId]);
    return { ...row, movements: movements.map((movement: { type: string; sourceType: string | null }) => ({
      ...movement, classification: classifyInventoryVarianceMovement(movement.type, movement.sourceType),
    })), closingCountAdjustment: closingAdjustment ?? null };
  }

  private async calculate(tenantId: string, query: InventoryVarianceIntervalDto & Partial<InventoryVarianceQueryDto>, itemId: string | null) {
    await this.gate(tenantId);
    const { opening, closing } = await this.interval(tenantId, query);
    const sortBy = query.sortBy ?? "variance";
    const sortDirection = query.sortDirection === "ASC" ? "ASC" : "DESC";
    const sortColumn = sortBy === "itemName" ? `item_name ${sortDirection}`
      : sortBy === "variancePercent" ? `ABS(variance_percent) ${sortDirection} NULLS LAST`
        : `unexplained_variance ${sortDirection} NULLS LAST`;
    const jsonSortColumn = sortBy === "itemName" ? `"itemName" ${sortDirection}`
      : sortBy === "variancePercent" ? `ABS(NULLIF("variancePercent",'')::numeric) ${sortDirection} NULLS LAST`
        : `"unexplainedVariance"::numeric ${sortDirection} NULLS LAST`;
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const [result] = await this.db.query(`WITH period AS (
        SELECT o.completed_at AS opening_completed_at,c.completed_at AS closing_completed_at
        FROM inventory_stock_counts o CROSS JOIN inventory_stock_counts c
        WHERE o.coffee_shop_id=$1 AND c.coffee_shop_id=$1 AND o.id=$3 AND c.id=$4
      ), item_counts AS (
        SELECT i.id,i.name AS item_name,i.base_unit,ol.counted_quantity AS opening_quantity,ol.counted_at AS opening_counted_at,
          cl.counted_quantity AS closing_quantity,cl.counted_at AS closing_counted_at
        FROM inventory_items i
        LEFT JOIN LATERAL (SELECT sum(counted_quantity) AS counted_quantity,max(counted_at) AS counted_at FROM inventory_stock_count_lines WHERE coffee_shop_id=i.coffee_shop_id AND item_id=i.id AND count_id=$3) ol ON true
        LEFT JOIN LATERAL (SELECT sum(counted_quantity) AS counted_quantity,max(counted_at) AS counted_at FROM inventory_stock_count_lines WHERE coffee_shop_id=i.coffee_shop_id AND item_id=i.id AND count_id=$4) cl ON true
        WHERE i.coffee_shop_id=$1 AND ($8::uuid IS NULL OR i.id=$8::uuid)
      ), movement_rows AS (
        SELECT m.item_id,m.type::text AS movement_type,m.quantity_base,m.source_type,m.source_id,m.source_line_id,m.order_item_id,${SOURCE_VALID} AS source_valid,
          CASE WHEN m.type='PURCHASE_RECEIPT' AND m.source_type='GOODS_RECEIPT' THEN COALESCE(gr.received_at,m.created_at)
            WHEN m.type='WASTE' AND m.source_type='WASTE_RECORD' THEN COALESCE(w.wasted_at,m.created_at)
            ELSE m.created_at END AS effective_at
        FROM inventory_stock_movements m
        JOIN item_counts ic ON ic.id=m.item_id AND ic.opening_counted_at IS NOT NULL AND ic.closing_counted_at>ic.opening_counted_at
        ${SOURCE_JOINS}
        WHERE m.coffee_shop_id=$1 AND m.location_id=$2
          AND (CASE WHEN m.type='PURCHASE_RECEIPT' AND m.source_type='GOODS_RECEIPT' THEN COALESCE(gr.received_at,m.created_at)
            WHEN m.type='WASTE' AND m.source_type='WASTE_RECORD' THEN COALESCE(w.wasted_at,m.created_at)
            ELSE m.created_at END)>ic.opening_counted_at
          AND (CASE WHEN m.type='PURCHASE_RECEIPT' AND m.source_type='GOODS_RECEIPT' THEN COALESCE(gr.received_at,m.created_at)
            WHEN m.type='WASTE' AND m.source_type='WASTE_RECORD' THEN COALESCE(w.wasted_at,m.created_at)
            ELSE m.created_at END)<=ic.closing_counted_at
      ), movement_totals AS (
        SELECT item_id,
          COALESCE(sum(quantity_base) FILTER(WHERE movement_type=ANY($9::text[]) AND source_valid),0) AS trusted_inbound,
          COALESCE(-sum(quantity_base) FILTER(WHERE movement_type=ANY($10::text[]) AND source_valid),0) AS trusted_outbound,
          COALESCE(-sum(quantity_base) FILTER(WHERE movement_type=ANY($11::text[]) AND source_valid),0) AS theoretical_usage,
          COALESCE(-sum(quantity_base) FILTER(WHERE (movement_type='WASTE' OR source_type='WASTE_REVERSAL') AND source_valid),0) AS known_waste,
          COALESCE(-sum(quantity_base) FILTER(WHERE movement_type=ANY($12::text[]) AND source_valid),0) AS other_explained_consumption,
          count(*) FILTER(WHERE movement_type='MANUAL_ADJUSTMENT' AND source_type IS DISTINCT FROM 'WASTE_REVERSAL')::int AS manual_adjustment_count,
          COALESCE(sum(quantity_base) FILTER(WHERE movement_type='MANUAL_ADJUSTMENT' AND source_type IS DISTINCT FROM 'WASTE_REVERSAL'),0) AS manual_adjustment_quantity,
          count(*) FILTER(WHERE movement_type='OPENING_BALANCE')::int AS opening_balance_count,
          count(*) FILTER(WHERE movement_type='STOCK_COUNT_ADJUSTMENT')::int AS reconciliation_count,
          count(*) FILTER(WHERE NOT source_valid AND (movement_type IN ('PURCHASE_RECEIPT','SALE_CONSUMPTION','SALE_REVERSAL','WASTE') OR source_type='WASTE_REVERSAL'))::int AS invalid_source_count
        FROM movement_rows GROUP BY item_id
      ), coverage AS (
        SELECT count(oi.id)::int AS total_order_items,
          count(oi.id) FILTER(WHERE EXISTS(SELECT 1 FROM inventory_stock_movements sm
            JOIN inventory_recipe_components rc ON rc.coffee_shop_id=sm.coffee_shop_id AND rc.id=sm.recipe_component_id
              AND rc.recipe_version_id=sm.recipe_version_id AND rc.inventory_item_id=sm.item_id
            WHERE sm.coffee_shop_id=oi.coffee_shop_id AND sm.order_item_id=oi.id AND sm.source_type='ORDER_CONSUMPTION'
              AND sm.source_id=o.id::text AND sm.type='SALE_CONSUMPTION' AND sm.quantity_base<0
            GROUP BY rc.id,rc.quantity_base HAVING rc.quantity_base*oi.quantity=-sum(sm.quantity_base)))::int AS consumed_order_items
        FROM order_items oi JOIN orders o ON o.coffee_shop_id=oi.coffee_shop_id AND o.id=oi.order_id
        CROSS JOIN period p
        WHERE oi.coffee_shop_id=$1 AND o.created_at>p.opening_completed_at AND o.created_at<=p.closing_completed_at
          AND o.status NOT IN ('UNDER_REVIEW','CANCELED')
      ), calculated AS (
        SELECT ic.*,COALESCE(mt.trusted_inbound,0) AS trusted_inbound,COALESCE(mt.trusted_outbound,0) AS trusted_outbound,
          COALESCE(mt.theoretical_usage,0) AS theoretical_usage,COALESCE(mt.known_waste,0) AS known_waste,
          COALESCE(mt.other_explained_consumption,0) AS other_explained_consumption,
          COALESCE(mt.manual_adjustment_count,0) AS manual_adjustment_count,COALESCE(mt.manual_adjustment_quantity,0) AS manual_adjustment_quantity,
          COALESCE(mt.opening_balance_count,0) AS opening_balance_count,COALESCE(mt.reconciliation_count,0) AS reconciliation_count,
          COALESCE(mt.invalid_source_count,0) AS invalid_source_count,
          (ic.opening_quantity IS NOT NULL AND ic.closing_quantity IS NOT NULL AND ic.closing_counted_at>ic.opening_counted_at) AS is_calculable,
          CASE WHEN ic.opening_quantity IS NOT NULL AND ic.closing_quantity IS NOT NULL AND ic.closing_counted_at>ic.opening_counted_at
            THEN ic.opening_quantity+COALESCE(mt.trusted_inbound,0)-COALESCE(mt.trusted_outbound,0)-ic.closing_quantity END AS actual_depletion,
          CASE WHEN ic.opening_quantity IS NOT NULL AND ic.closing_quantity IS NOT NULL AND ic.closing_counted_at>ic.opening_counted_at
            THEN ic.opening_quantity+COALESCE(mt.trusted_inbound,0)-COALESCE(mt.trusted_outbound,0)-ic.closing_quantity
              -COALESCE(mt.theoretical_usage,0)-COALESCE(mt.known_waste,0)-COALESCE(mt.other_explained_consumption,0) END AS unexplained_variance,
          coverage.total_order_items,coverage.consumed_order_items,
          CASE WHEN coverage.total_order_items>0 THEN round(coverage.consumed_order_items::numeric/coverage.total_order_items*100,2)::text END AS order_coverage_percent
        FROM item_counts ic LEFT JOIN movement_totals mt ON mt.item_id=ic.id CROSS JOIN coverage
      ), flagged AS (
        SELECT calculated.*,
          array_remove(ARRAY[
            CASE WHEN NOT is_calculable THEN 'MISSING_PHYSICAL_COUNT' END,
            CASE WHEN is_calculable AND manual_adjustment_count>0 THEN 'MANUAL_ADJUSTMENTS' END,
            CASE WHEN is_calculable AND opening_balance_count>0 THEN 'OPENING_BALANCE_DURING_PERIOD' END,
            CASE WHEN is_calculable AND reconciliation_count>0 THEN 'COUNT_RECONCILIATION_DURING_PERIOD' END,
            CASE WHEN is_calculable AND invalid_source_count>0 THEN 'INVALID_MOVEMENT_SOURCE' END,
            CASE WHEN is_calculable AND total_order_items>consumed_order_items THEN 'ORDER_LINES_WITHOUT_INVENTORY_CONSUMPTION' END
          ],NULL)::text[] AS data_quality_flags
        FROM calculated
      ), classified AS (
        SELECT flagged.*,
          CASE WHEN NOT is_calculable THEN 'NOT_CALCULABLE'
            WHEN cardinality(data_quality_flags)>0 THEN 'CALCULABLE_WITH_WARNINGS' ELSE 'CALCULABLE' END AS calculation_status,
          CASE WHEN theoretical_usage<>0 THEN round(unexplained_variance/theoretical_usage*100,2) END AS variance_percent
        FROM flagged
      ), filtered AS (
        SELECT * FROM classified WHERE $5='ALL'
          OR ($5='POSITIVE' AND unexplained_variance>0)
          OR ($5='NEGATIVE' AND unexplained_variance<0)
          OR ($5='ZERO' AND unexplained_variance=0)
      ), page_rows AS (
        SELECT id AS "itemId",item_name AS "itemName",base_unit AS "baseUnit",opening_quantity::text AS "openingPhysicalQuantity",
          trusted_inbound::text AS "trustedInbound",trusted_outbound::text AS "trustedOutbound",closing_quantity::text AS "closingPhysicalQuantity",
          actual_depletion::text AS "actualDepletion",theoretical_usage::text AS "theoreticalSaleUsage",known_waste::text AS "knownWaste",
          other_explained_consumption::text AS "otherExplainedConsumption",unexplained_variance::text AS "unexplainedVariance",
          variance_percent::text AS "variancePercent",'UNAVAILABLE' AS "varianceCostStatus",NULL::text AS "varianceCostToman",
          CASE WHEN is_calculable THEN 'CALCULABLE' ELSE 'NOT_CALCULABLE' END AS "actualUsageStatus",
          calculation_status AS "calculationStatus",data_quality_flags AS "dataQualityFlags",
          manual_adjustment_count AS "manualAdjustmentCount",manual_adjustment_quantity::text AS "manualAdjustmentQuantity",
          opening_balance_count AS "openingBalanceCount",reconciliation_count AS "reconciliationCount",invalid_source_count AS "invalidSourceCount",
          opening_counted_at AS "openingCountedAt",closing_counted_at AS "closingCountedAt",
          total_order_items AS "orderItemsInCoverageWindow",consumed_order_items AS "orderItemsWithInventoryConsumption",
          order_coverage_percent AS "orderCoveragePercent"
        FROM filtered ORDER BY (calculation_status='NOT_CALCULABLE'),${sortColumn},item_name ASC,id ASC
        LIMIT $7 OFFSET (($6-1)*$7)
      ), summary AS (
        SELECT count(*)::int AS "itemsAnalyzed",
          count(*) FILTER(WHERE calculation_status<>'NOT_CALCULABLE')::int AS "calculableItems",
          count(*) FILTER(WHERE calculation_status='CALCULABLE_WITH_WARNINGS')::int AS "itemsWithWarnings",
          count(*) FILTER(WHERE calculation_status='NOT_CALCULABLE')::int AS "notCalculableItems",
          count(*) FILTER(WHERE unexplained_variance>0)::int AS "positiveVarianceItems",
          count(*) FILTER(WHERE unexplained_variance<0)::int AS "negativeVarianceItems",
          count(*) FILTER(WHERE unexplained_variance=0)::int AS "zeroVarianceItems",
          count(*) FILTER(WHERE calculation_status<>'NOT_CALCULABLE')::int AS "itemsWithoutHistoricalVarianceCost"
        FROM filtered
      )
      SELECT COALESCE((SELECT jsonb_agg(to_jsonb(page_rows) ORDER BY ("actualUsageStatus"='NOT_CALCULABLE'),${jsonSortColumn},"itemName", "itemId") FROM page_rows),'[]'::jsonb) AS items,
        (SELECT to_jsonb(summary) FROM summary) AS summary,(SELECT count(*)::int FROM filtered) AS total,
        (SELECT jsonb_build_object('orderItemsInCoverageWindow',total_order_items,'orderItemsWithInventoryConsumption',consumed_order_items,
          'orderCoveragePercent',CASE WHEN total_order_items>0 THEN round(consumed_order_items::numeric/total_order_items*100,2)::text END)
          FROM coverage) AS coverage`, [tenantId, query.locationId, query.openingCountId, query.closingCountId,
      query.varianceDirection ?? "ALL", page, limit, itemId, INVENTORY_VARIANCE_MOVEMENT_TYPES.PHYSICAL_INBOUND,
      INVENTORY_VARIANCE_MOVEMENT_TYPES.PHYSICAL_OUTBOUND, INVENTORY_VARIANCE_MOVEMENT_TYPES.THEORETICAL_SALE_USAGE,
      INVENTORY_VARIANCE_MOVEMENT_TYPES.OTHER_EXPLAINED_CONSUMPTION]);
    const { locationName } = opening;
    return {
      period: { locationId: query.locationId, locationName, openingCount: opening, closingCount: closing,
        boundary: "opening_counted_at < effective_movement_at <= closing_counted_at" },
      ...result, page, limit,
    };
  }
}
