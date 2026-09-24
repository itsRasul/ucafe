import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { InventoryDimension } from "./entities";
import { RecipeTargetDto, ReplaceRecipeComponentsDto } from "./recipes.dto";
import { addQuantities, quantityToBase } from "./quantity.util";

const uniqueConflict = (error: unknown): never => {
  if ((error as { code?: string }).code === "23505") throw new ConflictException("A recipe already exists for this menu target");
  throw error;
};

@Injectable()
export class RecipesService {
  constructor(private readonly db: DataSource, private readonly subscriptions: SubscriptionsService) {}

  private async gate(tenantId: string) { await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.Inventory); }

  async list(tenantId: string) {
    await this.gate(tenantId);
    return this.db.query(`WITH targets AS (
      SELECT i.coffee_shop_id,i.id AS menu_item_id,NULL::uuid AS menu_item_variant_id,i.name AS menu_item_name,
        NULL::varchar AS variant_name,i.deleted_at IS NOT NULL AS is_archived,i.is_available AS is_available,i.updated_at
      FROM menu_items i
      WHERE i.coffee_shop_id=$1 AND (i.deleted_at IS NULL OR EXISTS (
        SELECT 1 FROM inventory_recipes r WHERE r.coffee_shop_id=i.coffee_shop_id AND r.menu_item_id=i.id AND r.menu_item_variant_id IS NULL))
      UNION ALL
      SELECT i.coffee_shop_id,i.id,v.id,i.name,v.name,i.deleted_at IS NOT NULL,i.is_available AND v.is_available,i.updated_at
      FROM menu_items i JOIN menu_item_variants v ON v.coffee_shop_id=i.coffee_shop_id AND v.item_id=i.id
      WHERE i.coffee_shop_id=$1 AND (i.deleted_at IS NULL OR EXISTS (
        SELECT 1 FROM inventory_recipes r WHERE r.coffee_shop_id=v.coffee_shop_id AND r.menu_item_variant_id=v.id))
    )
    SELECT t.menu_item_id AS "menuItemId",t.menu_item_variant_id AS "menuItemVariantId",t.menu_item_name AS "menuItemName",
      t.variant_name AS "variantName",t.is_archived AS "isArchived",t.is_available AS "isAvailable",r.id AS "recipeId",
      CASE WHEN av.id IS NOT NULL THEN 'ACTIVE' WHEN dv.id IS NOT NULL THEN 'DRAFT' ELSE 'NONE' END AS status,
      av.id AS "activeVersionId",av.version_number AS "activeVersionNumber",av.effective_from AS "effectiveFrom",
      dv.id AS "draftVersionId",dv.version_number AS "draftVersionNumber",dv.revision AS "draftRevision",
      (SELECT count(*)::int FROM inventory_recipe_components c WHERE c.coffee_shop_id=$1 AND c.recipe_version_id=COALESCE(dv.id,av.id)) AS "componentCount",
      COALESCE(r.updated_at,t.updated_at) AS "updatedAt"
    FROM targets t
    LEFT JOIN inventory_recipes r ON r.coffee_shop_id=t.coffee_shop_id AND r.menu_item_id=t.menu_item_id AND r.menu_item_variant_id IS NOT DISTINCT FROM t.menu_item_variant_id
    LEFT JOIN inventory_recipe_versions av ON av.coffee_shop_id=r.coffee_shop_id AND av.recipe_id=r.id AND av.status='ACTIVE'
    LEFT JOIN inventory_recipe_versions dv ON dv.coffee_shop_id=r.coffee_shop_id AND dv.recipe_id=r.id AND dv.status='DRAFT'
    ORDER BY t.menu_item_name,t.variant_name NULLS FIRST`, [tenantId]);
  }

  async get(tenantId: string, recipeId: string) {
    await this.gate(tenantId);
    const [recipe] = await this.db.query(`SELECT r.id,r.menu_item_id AS "menuItemId",r.menu_item_variant_id AS "menuItemVariantId",
      i.name AS "menuItemName",i.deleted_at AS "menuItemDeletedAt",v.name AS "variantName",v.is_available AS "variantAvailable",
      r.created_at AS "createdAt",r.updated_at AS "updatedAt"
      FROM inventory_recipes r JOIN menu_items i ON i.coffee_shop_id=r.coffee_shop_id AND i.id=r.menu_item_id
      LEFT JOIN menu_item_variants v ON v.coffee_shop_id=r.coffee_shop_id AND v.item_id=r.menu_item_id AND v.id=r.menu_item_variant_id
      WHERE r.coffee_shop_id=$1 AND r.id=$2`, [tenantId, recipeId]);
    if (!recipe) throw new NotFoundException("Recipe not found");
    const versions = await this.db.query(`SELECT id,version_number AS "versionNumber",status,revision,
      created_by_user_id AS "createdByUserId",published_by_user_id AS "publishedByUserId",
      effective_from AS "effectiveFrom",created_at AS "createdAt",updated_at AS "updatedAt"
      FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 ORDER BY version_number DESC`, [tenantId, recipeId]);
    const ids = versions.map((version: { id: string }) => version.id);
    const components = ids.length ? await this.db.query(`SELECT c.recipe_version_id AS "recipeVersionId",c.id,c.inventory_item_id AS "inventoryItemId",
      c.inventory_item_name_snapshot AS "inventoryItemName",c.quantity_display::text AS quantity,c.unit,
      c.quantity_base::text AS "quantityBase",c.note,i.dimension,i.base_unit AS "baseUnit",i.is_active AS "itemActive"
      FROM inventory_recipe_components c JOIN inventory_items i ON i.coffee_shop_id=c.coffee_shop_id AND i.id=c.inventory_item_id
      WHERE c.coffee_shop_id=$1 AND c.recipe_version_id=ANY($2::uuid[]) ORDER BY c.created_at,c.inventory_item_name_snapshot`, [tenantId, ids]) : [];
    return { ...recipe, versions: versions.map((version: { id: string }) => ({ ...version, components: components.filter((component: { recipeVersionId: string }) => component.recipeVersionId === version.id) })) };
  }

  async create(tenantId: string, actorId: string, input: RecipeTargetDto) {
    await this.gate(tenantId);
    try {
      const id = await this.db.transaction(async (manager) => {
        const [item] = await manager.query(`SELECT id FROM menu_items WHERE coffee_shop_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE`, [tenantId, input.menuItemId]);
        if (!item) throw new NotFoundException("Menu item not found");
        if (input.menuItemVariantId) {
          const [variant] = await manager.query(`SELECT id FROM menu_item_variants WHERE coffee_shop_id=$1 AND item_id=$2 AND id=$3 FOR SHARE`, [tenantId, input.menuItemId, input.menuItemVariantId]);
          if (!variant) throw new NotFoundException("Menu variant not found");
        }
        const [recipe] = await manager.query(`INSERT INTO inventory_recipes(coffee_shop_id,menu_item_id,menu_item_variant_id) VALUES($1,$2,$3) RETURNING id`, [tenantId, input.menuItemId, input.menuItemVariantId ?? null]);
        await manager.query(`INSERT INTO inventory_recipe_versions(coffee_shop_id,recipe_id,version_number,status,created_by_user_id) VALUES($1,$2,1,'DRAFT',$3)`, [tenantId, recipe.id, actorId]);
        return recipe.id as string;
      });
      return this.get(tenantId, id);
    } catch (error) { return uniqueConflict(error); }
  }

  async createVersion(tenantId: string, actorId: string, recipeId: string) {
    await this.gate(tenantId);
    const versionId = await this.db.transaction(async (manager) => {
      const [recipe] = await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, recipeId]);
      if (!recipe) throw new NotFoundException("Recipe not found");
      const [draft] = await manager.query(`SELECT id FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='DRAFT'`, [tenantId, recipeId]);
      if (draft) throw new ConflictException("Finish or publish the existing draft before creating another version");
      const [latest] = await manager.query(`SELECT COALESCE(max(version_number),0)::int AS number FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2`, [tenantId, recipeId]);
      const [version] = await manager.query(`INSERT INTO inventory_recipe_versions(coffee_shop_id,recipe_id,version_number,status,created_by_user_id)
        VALUES($1,$2,$3,'DRAFT',$4) RETURNING id`, [tenantId, recipeId, latest.number + 1, actorId]);
      await manager.query(`INSERT INTO inventory_recipe_components(coffee_shop_id,recipe_version_id,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base,note)
        SELECT coffee_shop_id,$3,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base,note
        FROM inventory_recipe_components WHERE coffee_shop_id=$1 AND recipe_version_id=(
          SELECT id FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='ACTIVE')`, [tenantId, recipeId, version.id]);
      return version.id as string;
    });
    const result = await this.get(tenantId, recipeId);
    return result.versions.find((version: { id: string }) => version.id === versionId);
  }

  async replaceComponents(tenantId: string, recipeId: string, versionId: string, input: ReplaceRecipeComponentsDto) {
    await this.gate(tenantId);
    if (new Set(input.components.map((component) => component.inventoryItemId)).size !== input.components.length) throw new BadRequestException("An inventory item can appear only once in a recipe version");
    await this.db.transaction(async (manager) => {
      const [recipe] = await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND id=$2 FOR UPDATE`, [tenantId, recipeId]);
      if (!recipe) throw new NotFoundException("Recipe not found");
      const [version] = await manager.query(`SELECT id,status,revision FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND id=$3 FOR UPDATE`, [tenantId, recipeId, versionId]);
      if (!version) throw new NotFoundException("Recipe version not found");
      if (version.status !== "DRAFT") throw new ConflictException("Published recipe versions cannot be edited; create a new version instead");
      if (version.revision !== input.expectedRevision) throw new ConflictException("This draft changed in another session. Reload it before saving");
      const existing = await manager.query(`SELECT inventory_item_id AS id FROM inventory_recipe_components WHERE coffee_shop_id=$1 AND recipe_version_id=$2`, [tenantId, versionId]);
      const existingIds = new Set(existing.map((row: { id: string }) => row.id));
      const itemIds = input.components.map((component) => component.inventoryItemId);
      const items = itemIds.length ? await manager.query(`SELECT id,name,dimension,base_unit AS "baseUnit",is_active AS "isActive" FROM inventory_items WHERE coffee_shop_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`, [tenantId, itemIds]) : [];
      const itemById = new Map(items.map((item: { id: string }) => [item.id, item]));
      const normalized = input.components.map((component) => {
        const item = itemById.get(component.inventoryItemId) as { id: string; name: string; dimension: InventoryDimension; baseUnit: string; isActive: boolean } | undefined;
        if (!item) throw new NotFoundException("Inventory item does not belong to this tenant");
        if (!item.isActive && !existingIds.has(item.id)) throw new ConflictException("Inactive inventory items cannot be added to a new recipe component");
        const quantityBase = quantityToBase(component.quantity, item.dimension, component.unit, item.baseUnit);
        if (quantityBase === "0" || quantityBase.startsWith("-")) throw new BadRequestException("Recipe component quantity must be greater than zero");
        return { ...component, item, quantityBase };
      });
      await manager.query(`DELETE FROM inventory_recipe_components WHERE coffee_shop_id=$1 AND recipe_version_id=$2`, [tenantId, versionId]);
      for (const component of normalized) await manager.query(`INSERT INTO inventory_recipe_components(
        coffee_shop_id,recipe_version_id,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base,note)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, versionId, component.inventoryItemId, component.item.name, component.quantity, component.unit, component.quantityBase, component.note?.trim() || null]);
      await manager.query(`UPDATE inventory_recipe_versions SET revision=revision+1,updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, versionId]);
      await manager.query(`UPDATE inventory_recipes SET updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, recipeId]);
    });
    const result = await this.get(tenantId, recipeId);
    return result.versions.find((version: { id: string }) => version.id === versionId);
  }

  async publish(tenantId: string, actorId: string, recipeId: string, versionId: string) {
    await this.gate(tenantId);
    await this.db.transaction(async (manager) => {
      const [recipe] = await manager.query(`SELECT r.id,r.menu_item_id AS "menuItemId",r.menu_item_variant_id AS "menuItemVariantId"
        FROM inventory_recipes r JOIN menu_items i ON i.coffee_shop_id=r.coffee_shop_id AND i.id=r.menu_item_id
        WHERE r.coffee_shop_id=$1 AND r.id=$2 AND i.deleted_at IS NULL FOR UPDATE OF r,i`, [tenantId, recipeId]);
      if (!recipe) throw new ConflictException("Recipes for deleted menu items cannot be published");
      if (recipe.menuItemVariantId) {
        const [variant] = await manager.query(`SELECT id FROM menu_item_variants WHERE coffee_shop_id=$1 AND item_id=$2 AND id=$3`, [tenantId, recipe.menuItemId, recipe.menuItemVariantId]);
        if (!variant) throw new ConflictException("Menu variant no longer exists");
      }
      const [version] = await manager.query(`SELECT id,status FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND id=$3 FOR UPDATE`, [tenantId, recipeId, versionId]);
      if (!version) throw new NotFoundException("Recipe version not found");
      if (version.status !== "DRAFT") throw new ConflictException("Only a draft recipe version can be published");
      const components = await manager.query(`SELECT c.quantity_display::text AS quantity,c.quantity_base::text AS "quantityBase",c.unit,
        i.dimension,i.base_unit AS "baseUnit" FROM inventory_recipe_components c
        JOIN inventory_items i ON i.coffee_shop_id=c.coffee_shop_id AND i.id=c.inventory_item_id
        WHERE c.coffee_shop_id=$1 AND c.recipe_version_id=$2`, [tenantId, versionId]);
      if (!components.length) throw new BadRequestException("A recipe must have at least one ingredient before publishing");
      for (const component of components) {
        const normalized = quantityToBase(component.quantity, component.dimension, component.unit, component.baseUnit);
        if (normalized === "0" || normalized.startsWith("-") || addQuantities(normalized) !== addQuantities(component.quantityBase)) throw new BadRequestException("Recipe component quantity is invalid; review the draft");
      }
      await manager.query(`UPDATE inventory_recipe_versions SET status='SUPERSEDED',updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='ACTIVE'`, [tenantId, recipeId]);
      const [activated] = await manager.query(`UPDATE inventory_recipe_versions SET status='ACTIVE',published_by_user_id=$4,effective_from=clock_timestamp(),updated_at=clock_timestamp()
        WHERE coffee_shop_id=$1 AND recipe_id=$2 AND id=$3 AND status='DRAFT' RETURNING id`, [tenantId, recipeId, versionId, actorId]);
      if (!activated) throw new ConflictException("Recipe draft could not be published");
      await manager.query(`UPDATE inventory_recipes SET updated_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, recipeId]);
    });
    return this.get(tenantId, recipeId);
  }

  async duplicate(tenantId: string, actorId: string, sourceRecipeId: string, target: RecipeTargetDto) {
    await this.gate(tenantId);
    try {
      const recipeId = await this.db.transaction(async (manager) => {
        const [source] = await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND id=$2 FOR SHARE`, [tenantId, sourceRecipeId]);
        if (!source) throw new NotFoundException("Source recipe not found");
        const [item] = await manager.query(`SELECT id FROM menu_items WHERE coffee_shop_id=$1 AND id=$2 AND deleted_at IS NULL FOR SHARE`, [tenantId, target.menuItemId]);
        if (!item) throw new NotFoundException("Menu item not found");
        if (target.menuItemVariantId) {
          const [variant] = await manager.query(`SELECT id FROM menu_item_variants WHERE coffee_shop_id=$1 AND item_id=$2 AND id=$3 FOR SHARE`, [tenantId, target.menuItemId, target.menuItemVariantId]);
          if (!variant) throw new NotFoundException("Menu variant not found");
        }
        const [active] = await manager.query(`SELECT id FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='ACTIVE'`, [tenantId, sourceRecipeId]);
        if (!active) throw new ConflictException("Publish the source recipe before copying it");
        const [recipe] = await manager.query(`INSERT INTO inventory_recipes(coffee_shop_id,menu_item_id,menu_item_variant_id) VALUES($1,$2,$3) RETURNING id`, [tenantId, target.menuItemId, target.menuItemVariantId ?? null]);
        const [version] = await manager.query(`INSERT INTO inventory_recipe_versions(coffee_shop_id,recipe_id,version_number,status,created_by_user_id) VALUES($1,$2,1,'DRAFT',$3) RETURNING id`, [tenantId, recipe.id, actorId]);
        await manager.query(`INSERT INTO inventory_recipe_components(coffee_shop_id,recipe_version_id,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base,note)
          SELECT coffee_shop_id,$3,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base,note
          FROM inventory_recipe_components WHERE coffee_shop_id=$1 AND recipe_version_id=$2`, [tenantId, active.id, version.id]);
        return recipe.id as string;
      });
      return this.get(tenantId, recipeId);
    } catch (error) { return uniqueConflict(error); }
  }

  async resolveActiveRecipe(tenantId: string, menuItemId: string, menuItemVariantId?: string | null, manager?: EntityManager, checkFeature = true) {
    if (checkFeature) await this.gate(tenantId);
    const query = manager?.query.bind(manager) ?? this.db.query.bind(this.db);
    const lock = manager ? " FOR SHARE" : "";
    if (menuItemVariantId) {
      const [variant] = await query(`SELECT id FROM menu_item_variants WHERE coffee_shop_id=$1 AND item_id=$2 AND id=$3`, [tenantId, menuItemId, menuItemVariantId]);
      if (!variant) throw new NotFoundException("Menu variant not found");
    }
    const [recipe] = await query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND menu_item_id=$2
      AND (menu_item_variant_id=$3 OR menu_item_variant_id IS NULL)
      ORDER BY CASE WHEN menu_item_variant_id=$3 THEN 0 ELSE 1 END LIMIT 1${lock}`, [tenantId, menuItemId, menuItemVariantId ?? null]);
    if (!recipe) return null;
    const [active] = await query(`SELECT id AS "recipeVersionId",version_number AS "versionNumber",effective_from AS "effectiveFrom"
      FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='ACTIVE'${lock}`, [tenantId, recipe.id]);
    if (!active) throw new ConflictException({ code: "INVENTORY_RECIPE_INVALID", message: "A configured order recipe has no active version" });
    const components = await query(`SELECT id AS "recipeComponentId",inventory_item_id AS "inventoryItemId",inventory_item_name_snapshot AS "inventoryItemName",
      quantity_display::text AS quantity,unit,quantity_base::text AS "quantityBase",note
      FROM inventory_recipe_components WHERE coffee_shop_id=$1 AND recipe_version_id=$2 ORDER BY id`, [tenantId, active.recipeVersionId]);
    if (!components.length) throw new ConflictException({ code: "INVENTORY_RECIPE_INVALID", message: "An active order recipe has no components" });
    return { recipeId: recipe.id, ...active, components };
  }
}
