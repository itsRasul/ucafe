import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { MenuProfitabilityQueryDto } from "./costing.dto";

const costIsValid = (cost: string | null) => cost === null || /^\d{1,14}(?:\.\d{1,6})?$/.test(cost);
const statusFor = (row: { recipeVersionId: string | null; componentCount: number; costedComponentCount: number }) => {
  if (!row.recipeVersionId) return "NO_ACTIVE_VERSION";
  if (!row.componentCount || row.costedComponentCount < row.componentCount) {
    return row.costedComponentCount ? "INCOMPLETE" : "NO_COST_DATA";
  }
  return "COMPLETE";
};
type MenuProfitabilityItem = Record<string, unknown> & {
  menuItemId: string;
  menuItemVariantId: string | null;
  sellingPriceToman: string | null;
  recipeCostToman: string | null;
  recipeFallback: string | null;
  costStatus: string;
  costLocationId: string | null;
  costLocationName: string | null;
};
type MenuProfitabilityCategory = { id: string; name: string };

@Injectable()
export class RecipeCostingService {
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private async gate(tenantId: string) {
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory);
  }

  async recipeCost(tenantId: string, recipeId: string, versionId?: string) {
    await this.gate(tenantId);
    const [row] = await this.db.query(`WITH target AS (
      SELECT r.id AS "recipeId",r.menu_item_id AS "menuItemId",r.menu_item_variant_id AS "menuItemVariantId",
        i.name AS "menuItemName",v.name AS "variantName",i.deleted_at IS NOT NULL AS "menuItemArchived",
        CASE WHEN r.menu_item_variant_id IS NULL THEN i.base_price_toman::text ELSE v.price_toman::text END AS "sellingPriceToman",
        selected.id AS "recipeVersionId",selected.version_number AS "recipeVersionNumber",selected.status AS "recipeVersionStatus",
        location.id AS "costLocationId",location.name AS "costLocationName"
      FROM inventory_recipes r
      JOIN menu_items i ON i.coffee_shop_id=r.coffee_shop_id AND i.id=r.menu_item_id
      LEFT JOIN menu_item_variants v ON v.coffee_shop_id=r.coffee_shop_id AND v.item_id=r.menu_item_id AND v.id=r.menu_item_variant_id
      LEFT JOIN LATERAL (
        SELECT rv.id,rv.version_number,rv.status FROM inventory_recipe_versions rv
        WHERE rv.coffee_shop_id=r.coffee_shop_id AND rv.recipe_id=r.id
          AND (($3::uuid IS NULL AND rv.status='ACTIVE') OR ($3::uuid IS NOT NULL AND rv.id=$3::uuid))
        LIMIT 1
      ) selected ON true
      LEFT JOIN inventory_locations location ON location.coffee_shop_id=r.coffee_shop_id AND location.is_default AND location.is_active
      WHERE r.coffee_shop_id=$1 AND r.id=$2
    )
    SELECT target.*,
      count(component.id)::int AS "componentCount",
      count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL)::int AS "costedComponentCount",
      count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)::int AS "missingCostCount",
      count(component.id) FILTER (WHERE NOT item.is_active)::int AS "inactiveComponentCount",
      CASE WHEN count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL)=0 THEN NULL
        ELSE sum(component.quantity_base*balance.average_unit_cost_toman) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL)::text END AS "totalKnownCostToman",
      CASE WHEN count(component.id)>0 AND count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)=0
        THEN sum(component.quantity_base*balance.average_unit_cost_toman)::text END AS "recipeCostToman",
      CASE WHEN count(component.id)>0 AND count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)=0
        AND target."sellingPriceToman" IS NOT NULL
        THEN (target."sellingPriceToman"::numeric-sum(component.quantity_base*balance.average_unit_cost_toman))::text END AS "grossProfitToman",
      CASE WHEN count(component.id)>0 AND count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)=0
        AND target."sellingPriceToman"::numeric>0
        THEN round((target."sellingPriceToman"::numeric-sum(component.quantity_base*balance.average_unit_cost_toman)) / target."sellingPriceToman"::numeric * 100,2)::text END AS "grossMarginPercent",
      CASE WHEN count(component.id)>0 AND count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)=0
        AND target."sellingPriceToman"::numeric>0
        THEN round(sum(component.quantity_base*balance.average_unit_cost_toman) / target."sellingPriceToman"::numeric * 100,2)::text END AS "materialCostPercent",
      coalesce(jsonb_agg(jsonb_build_object(
        'recipeComponentId',component.id,'inventoryItemId',component.inventory_item_id,
        'inventoryItemName',component.inventory_item_name_snapshot,'quantity',component.quantity_display::text,
        'unit',component.unit,'normalizedQuantity',component.quantity_base::text,'normalizedUnit',item.base_unit,
        'normalizedUnitCostToman',balance.average_unit_cost_toman::text,
        'componentCostToman',CASE WHEN balance.average_unit_cost_toman IS NULL THEN NULL ELSE (component.quantity_base*balance.average_unit_cost_toman)::text END,
        'costAvailable',balance.average_unit_cost_toman IS NOT NULL,'itemActive',item.is_active,'note',component.note
      ) ORDER BY component.created_at,component.id) FILTER (WHERE component.id IS NOT NULL),'[]'::jsonb) AS components,
      coalesce(jsonb_agg(jsonb_build_object(
        'inventoryItemId',component.inventory_item_id,'inventoryItemName',component.inventory_item_name_snapshot,
        'quantity',component.quantity_display::text,'unit',component.unit,
        'itemActive',item.is_active,'reason',CASE WHEN NOT item.is_active THEN 'INACTIVE_ITEM' ELSE 'COST_NOT_RECORDED' END
      ) ORDER BY component.created_at,component.id) FILTER (WHERE component.id IS NOT NULL AND balance.average_unit_cost_toman IS NULL),'[]'::jsonb) AS "missingCostItems"
    FROM target
    LEFT JOIN inventory_recipe_components component ON component.coffee_shop_id=$1 AND component.recipe_version_id=target."recipeVersionId"
    LEFT JOIN inventory_items item ON item.coffee_shop_id=component.coffee_shop_id AND item.id=component.inventory_item_id
    LEFT JOIN inventory_stock_balances balance ON balance.coffee_shop_id=component.coffee_shop_id
      AND balance.item_id=component.inventory_item_id AND balance.location_id=target."costLocationId"
    GROUP BY target."recipeId",target."menuItemId",target."menuItemVariantId",target."menuItemName",target."variantName",
      target."menuItemArchived",target."sellingPriceToman",target."recipeVersionId",
      target."sellingPriceToman",target."recipeVersionNumber",target."recipeVersionStatus",target."costLocationId",target."costLocationName"`,
    [tenantId, recipeId, versionId ?? null]);

    if (!row) throw new NotFoundException("Recipe not found");
    if (versionId && !row.recipeVersionId) throw new NotFoundException("Recipe version not found");
    for (const component of row.components as Array<{ normalizedUnitCostToman: string | null }>) {
      if (!costIsValid(component.normalizedUnitCostToman)) throw new ConflictException("Inventory item has an invalid average cost");
    }
    const componentCount = Number(row.componentCount);
    const costedComponentCount = Number(row.costedComponentCount);
    const costStatus = !row.recipeVersionId ? "NO_ACTIVE_VERSION" : !componentCount ? "INCOMPLETE" : statusFor({ ...row, componentCount, costedComponentCount });
    const sellingPriceToman = row.sellingPriceToman;
    const complete = costStatus === "COMPLETE";

    return {
      recipeId: row.recipeId,
      menuItemId: row.menuItemId,
      menuItemVariantId: row.menuItemVariantId,
      menuItemName: row.menuItemName,
      variantName: row.variantName,
      menuItemArchived: row.menuItemArchived,
      recipeVersionId: row.recipeVersionId,
      recipeVersionNumber: row.recipeVersionNumber,
      recipeVersionStatus: row.recipeVersionStatus,
      costSemantics: "CURRENT_COST_ESTIMATE",
      costBasis: "CURRENT_LOCATION_AVERAGE_COST",
      costLocation: row.costLocationId ? { id: row.costLocationId, name: row.costLocationName } : null,
      costStatus,
      componentCount,
      costedComponentCount,
      missingCostCount: Number(row.missingCostCount),
      inactiveComponentCount: Number(row.inactiveComponentCount),
      totalKnownCostToman: row.totalKnownCostToman,
      recipeCostToman: complete ? row.recipeCostToman : null,
      sellingPriceToman,
      grossProfitToman: complete ? row.grossProfitToman : null,
      grossMarginPercent: complete ? row.grossMarginPercent : null,
      materialCostPercent: complete ? row.materialCostPercent : null,
      components: row.components,
      missingCostItems: row.missingCostItems,
    };
  }

  async menuProfitability(tenantId: string, query: MenuProfitabilityQueryDto) {
    await this.gate(tenantId);
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;
    const sortColumns: Record<string, string> = {
      sellingPrice: '"sellingPriceToman"', recipeCost: '"recipeCostToman"', grossProfit: '"grossProfitToman"',
      grossMargin: '"grossMarginPercent"', materialCost: '"materialCostPercent"',
    };
    const sort = sortColumns[query.sortBy ?? ""] ?? '"menuItemName"';
    const direction = query.sortDirection === "DESC" ? "DESC" : "ASC";
    const [result] = await this.db.query(`WITH default_location AS (
      SELECT id,name FROM inventory_locations WHERE coffee_shop_id=$1 AND is_default AND is_active
    ), offers AS (
      SELECT i.id AS menu_item_id,NULL::uuid AS menu_item_variant_id,i.name AS menu_item_name,
        NULL::varchar AS variant_name,i.category_id,m.name AS category_name,i.deleted_at IS NOT NULL AS is_archived,
        i.is_available AND m.is_active AND i.deleted_at IS NULL AS is_available,
        i.base_price_toman::text AS selling_price_toman
      FROM menu_items i JOIN menu_categories m ON m.coffee_shop_id=i.coffee_shop_id AND m.id=i.category_id
      WHERE i.coffee_shop_id=$1 AND NOT EXISTS(
        SELECT 1 FROM menu_item_variants v WHERE v.coffee_shop_id=i.coffee_shop_id AND v.item_id=i.id
      ) AND ($2::boolean OR (i.deleted_at IS NULL AND i.is_available AND m.is_active AND m.deleted_at IS NULL))
      UNION ALL
      SELECT i.id,v.id,i.name,v.name,i.category_id,m.name AS category_name,i.deleted_at IS NOT NULL AS is_archived,
        i.is_available AND v.is_available AND m.is_active AND i.deleted_at IS NULL AS is_available,
        v.price_toman::text AS selling_price_toman
      FROM menu_items i JOIN menu_item_variants v ON v.coffee_shop_id=i.coffee_shop_id AND v.item_id=i.id
      JOIN menu_categories m ON m.coffee_shop_id=i.coffee_shop_id AND m.id=i.category_id
      WHERE i.coffee_shop_id=$1 AND ($2::boolean OR (i.deleted_at IS NULL AND i.is_available AND v.is_available AND m.is_active AND m.deleted_at IS NULL))
    ), resolved AS (
      SELECT offer.*,
        recipe.id AS recipe_id,
        version.id AS recipe_version_id,
        version.version_number AS recipe_version_number,
        CASE WHEN offer.menu_item_variant_id IS NOT NULL AND recipe.menu_item_variant_id IS NULL THEN 'MENU_ITEM' ELSE NULL END AS recipe_fallback
      FROM offers offer
      LEFT JOIN LATERAL (
        SELECT r.id,r.menu_item_variant_id FROM inventory_recipes r
        WHERE r.coffee_shop_id=$1 AND r.menu_item_id=offer.menu_item_id
          AND (r.menu_item_variant_id=offer.menu_item_variant_id OR r.menu_item_variant_id IS NULL)
        ORDER BY CASE WHEN r.menu_item_variant_id=offer.menu_item_variant_id THEN 0 ELSE 1 END
        LIMIT 1
      ) recipe ON true
      LEFT JOIN LATERAL (
        SELECT v.id,v.version_number FROM inventory_recipe_versions v
        WHERE v.coffee_shop_id=$1 AND v.recipe_id=recipe.id AND v.status='ACTIVE' LIMIT 1
      ) version ON true
    ), totaled AS (
      SELECT resolved.*,
        location.id AS cost_location_id,location.name AS cost_location_name,
        count(component.id)::int AS component_count,
        count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL)::int AS costed_component_count,
        count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NULL)::int AS missing_cost_count,
        count(component.id) FILTER (WHERE NOT item.is_active)::int AS inactive_component_count,
        CASE WHEN count(component.id) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL)=0 THEN NULL
          ELSE sum(component.quantity_base*balance.average_unit_cost_toman) FILTER (WHERE balance.average_unit_cost_toman IS NOT NULL) END AS total_known_cost_toman
      FROM resolved
      LEFT JOIN default_location location ON true
      LEFT JOIN inventory_recipe_components component ON component.coffee_shop_id=$1 AND component.recipe_version_id=resolved.recipe_version_id
      LEFT JOIN inventory_items item ON item.coffee_shop_id=component.coffee_shop_id AND item.id=component.inventory_item_id
      LEFT JOIN inventory_stock_balances balance ON balance.coffee_shop_id=component.coffee_shop_id
        AND balance.item_id=component.inventory_item_id AND balance.location_id=location.id
      GROUP BY resolved.menu_item_id,resolved.menu_item_variant_id,resolved.menu_item_name,resolved.variant_name,
        resolved.category_id,resolved.category_name,resolved.is_archived,resolved.is_available,resolved.selling_price_toman,
        resolved.recipe_id,resolved.recipe_version_id,resolved.recipe_version_number,resolved.recipe_fallback,location.id,location.name
    ), classified AS (
      SELECT totaled.*,
        CASE WHEN recipe_id IS NULL THEN 'NOT_CONFIGURED'
          WHEN recipe_version_id IS NULL THEN 'NO_ACTIVE_VERSION'
          WHEN component_count=0 THEN 'INCOMPLETE'
          WHEN missing_cost_count=0 THEN 'COMPLETE'
          WHEN costed_component_count=0 THEN 'NO_COST_DATA'
          ELSE 'INCOMPLETE' END AS costing_status,
        CASE WHEN recipe_version_id IS NOT NULL AND component_count>0 AND missing_cost_count=0 THEN total_known_cost_toman END AS recipe_cost_toman
      FROM totaled
    ), profitability AS (
      SELECT classified.*,
        CASE WHEN recipe_cost_toman IS NOT NULL AND selling_price_toman IS NOT NULL
          THEN selling_price_toman::numeric-recipe_cost_toman END AS gross_profit_toman,
        CASE WHEN recipe_cost_toman IS NOT NULL AND selling_price_toman::numeric>0
          THEN round((selling_price_toman::numeric-recipe_cost_toman)/selling_price_toman::numeric*100,2) END AS gross_margin_percent,
        CASE WHEN recipe_cost_toman IS NOT NULL AND selling_price_toman::numeric>0
          THEN round(recipe_cost_toman/selling_price_toman::numeric*100,2) END AS material_cost_percent
      FROM classified
    ), filtered AS (
      SELECT * FROM profitability
      WHERE ($3::text IS NULL OR menu_item_name ILIKE '%'||$3||'%' OR variant_name ILIKE '%'||$3||'%')
        AND ($4::uuid IS NULL OR category_id=$4::uuid)
        AND ($5::text IS NULL OR costing_status=$5)
    ), page_rows AS (
      SELECT menu_item_id AS "menuItemId",menu_item_variant_id AS "menuItemVariantId",menu_item_name AS "menuItemName",
        variant_name AS "variantName",category_id AS "categoryId",category_name AS "categoryName",is_archived AS "isArchived",
        is_available AS "isAvailable",selling_price_toman AS "sellingPriceToman",recipe_id AS "recipeId",
        recipe_version_id AS "recipeVersionId",recipe_version_number AS "recipeVersionNumber",recipe_fallback AS "recipeFallback",
        cost_location_id AS "costLocationId",cost_location_name AS "costLocationName",costing_status AS "costStatus",
        component_count AS "componentCount",costed_component_count AS "costedComponentCount",missing_cost_count AS "missingCostCount",
        inactive_component_count AS "inactiveComponentCount",total_known_cost_toman::text AS "totalKnownCostToman",
        recipe_cost_toman::text AS "recipeCostToman",gross_profit_toman::text AS "grossProfitToman",
        gross_margin_percent::text AS "grossMarginPercent",material_cost_percent::text AS "materialCostPercent",
        (SELECT coalesce(jsonb_agg(jsonb_build_object(
          'inventoryItemId',component.inventory_item_id,'inventoryItemName',component.inventory_item_name_snapshot,
          'quantity',component.quantity_display::text,'unit',component.unit,'itemActive',item.is_active,
          'reason',CASE WHEN NOT item.is_active THEN 'INACTIVE_ITEM' ELSE 'COST_NOT_RECORDED' END
        ) ORDER BY component.created_at,component.id),'[]'::jsonb)
         FROM inventory_recipe_components component
         JOIN inventory_items item ON item.coffee_shop_id=component.coffee_shop_id AND item.id=component.inventory_item_id
         LEFT JOIN inventory_stock_balances balance ON balance.coffee_shop_id=component.coffee_shop_id
           AND balance.item_id=component.inventory_item_id AND balance.location_id=filtered.cost_location_id
         WHERE component.coffee_shop_id=$1 AND component.recipe_version_id=filtered.recipe_version_id AND balance.average_unit_cost_toman IS NULL
        ) AS "missingCostItems"
      FROM filtered
      ORDER BY ${sort} ${direction} NULLS LAST,"menuItemName" ASC,"variantName" ASC NULLS FIRST,"menuItemId" ASC,"menuItemVariantId" ASC NULLS FIRST
      LIMIT $6 OFFSET $7
    )
    SELECT coalesce(jsonb_agg(to_jsonb(page_rows) ORDER BY ${sort} ${direction} NULLS LAST,"menuItemName" ASC,"variantName" ASC NULLS FIRST,"menuItemId" ASC,"menuItemVariantId" ASC),'[]'::jsonb) AS items,
      (SELECT count(*)::int FROM filtered) AS total,
      (SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY name,id),'[]'::jsonb)
        FROM menu_categories WHERE coffee_shop_id=$1 AND deleted_at IS NULL) AS categories FROM page_rows`,
    [tenantId, query.includeUnavailable ?? false, query.search?.trim() || null, query.categoryId ?? null, query.costingStatus ?? null, limit, (page - 1) * limit]);

    const rows = (result.items ?? []) as MenuProfitabilityItem[];
    const items = rows.map(({ costLocationId, costLocationName, ...item }) => ({
      ...item,
      costSemantics: "CURRENT_COST_ESTIMATE",
      costBasis: "CURRENT_LOCATION_AVERAGE_COST",
      costLocation: costLocationId ? { id: costLocationId, name: costLocationName } : null,
    }));
    return { items, page, limit, total: result.total ?? 0, categories: result.categories as MenuProfitabilityCategory[] };
  }
}
