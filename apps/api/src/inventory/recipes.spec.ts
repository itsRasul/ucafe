import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { InventoryDimension } from "./entities";
import { RecipesService } from "./recipes.service";
import { RecipeComponentDto, ReplaceRecipeComponentsDto } from "./recipes.dto";
import { addQuantities } from "./quantity.util";
import { MenuService } from "../menu/menu.service";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";

test("recipe component input rejects duplicate inventory items and excess quantity precision", () => {
  const id = randomUUID();
  assert.ok(validateSync(plainToInstance(ReplaceRecipeComponentsDto, { expectedRevision: 0, components: [{ inventoryItemId: id, quantity: "1", unit: "g" }, { inventoryItemId: id, quantity: "2", unit: "g" }] })).length);
  assert.ok(validateSync(plainToInstance(RecipeComponentDto, { inventoryItemId: id, quantity: "0.0000001", unit: "g" })).length);
});

test("recipe APIs reject an unavailable inventory entitlement before database access", async () => {
  let queried = false;
  const service = new RecipesService({ query: async () => { queried = true; return []; } } as never, { requireFeature: async () => { throw new ForbiddenException(); } } as never);
  await assert.rejects(service.list("tenant"), ForbiddenException);
  assert.equal(queried, false);
});

test("recipes are tenant-scoped, unit-safe, versioned and never post stock movements", { skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL, entities: [CoffeeShop, Branch, Domain, MenuCategory, MenuItem, MenuItemVariant] });
  await db.initialize();
  const rollback = new Error(`rollback recipes ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [actor] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actor?.id, "integration database needs one administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Recipe Test',$2,'ACTIVE'),($3,'Recipe Test Other',$4,'ACTIVE')`, [tenantId, `recipe-${tenantId}`, otherTenantId, `recipe-${otherTenantId}`]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Drinks') RETURNING id`, [tenantId]);
      const [otherCategory] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Other') RETURNING id`, [otherTenantId]);
      const [item] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Latte',1000) RETURNING id`, [tenantId, category.id]);
      const [variant] = await manager.query(`INSERT INTO menu_item_variants(coffee_shop_id,item_id,name,price_toman) VALUES($1,$2,'Large',1500) RETURNING id`, [tenantId, item.id]);
      const [copyItem] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Mocha',1000) RETURNING id`, [tenantId, category.id]);
      const [foreignItem] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Foreign latte',1000) RETURNING id`, [otherTenantId, otherCategory.id]);
      const [coffee] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Coffee', 'WEIGHT','g') RETURNING id`, [tenantId]);
      const [milk] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Milk', 'VOLUME','ml') RETURNING id`, [tenantId]);
      const [foreignIngredient] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Foreign ingredient', 'WEIGHT','g') RETURNING id`, [otherTenantId]);
      const adapter = { manager, query: (sql: string, params?: unknown[]) => manager.query(sql, params), transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager) } as unknown as DataSource;
      const service = new RecipesService(adapter, { requireFeature: async () => undefined } as never);
      const menuService = new MenuService(adapter, { removeMenuItemImage: async () => undefined } as never);

      const initial = await service.create(tenantId, actor.id, { menuItemId: item.id });
      assert.equal(initial.versions[0].versionNumber, 1);
      assert.equal(initial.versions[0].status, "DRAFT");
      await assert.rejects(service.create(otherTenantId, actor.id, { menuItemId: item.id }), /Menu item not found/);
      await assert.rejects(service.create(tenantId, actor.id, { menuItemId: foreignItem.id }), /Menu item not found/);

      const firstDraft = initial.versions[0];
      const invalid = { expectedRevision: 0, components: [{ inventoryItemId: milk.id, quantity: "1", unit: "kg" }] };
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, invalid), BadRequestException);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: coffee.id, quantity: "1", unit: "g" }, { inventoryItemId: coffee.id, quantity: "2", unit: "g" }] }), BadRequestException);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: foreignIngredient.id, quantity: "1", unit: "g" }] }), /does not belong to this tenant/);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: coffee.id, quantity: "0", unit: "g" }] }), BadRequestException);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: coffee.id, quantity: "-1", unit: "g" }] }), BadRequestException);

      const saved = await service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: coffee.id, quantity: "18", unit: "g" }, { inventoryItemId: milk.id, quantity: "0.22", unit: "l" }] });
      assert.equal(saved.revision, 1);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 0, components: [] }), ConflictException);
      const published = await service.publish(tenantId, actor.id, initial.id, firstDraft.id);
      assert.equal(published.versions[0].status, "ACTIVE");
      assert.ok(published.versions[0].effectiveFrom);
      assert.equal(published.versions[0].publishedByUserId, actor.id);
      assert.equal(addQuantities(published.versions[0].components.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk.id).quantityBase), "220");
      await manager.query(`SAVEPOINT recipe_history_immutable`);
      await assert.rejects(manager.query(`UPDATE inventory_recipe_versions SET effective_from=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, firstDraft.id]));
      await manager.query(`ROLLBACK TO SAVEPOINT recipe_history_immutable`);
      await assert.rejects(service.replaceComponents(tenantId, initial.id, firstDraft.id, { expectedRevision: 1, components: [] }), ConflictException);

      const variantRecipe = await service.create(tenantId, actor.id, { menuItemId: item.id, menuItemVariantId: variant.id });
      const variantDraft = variantRecipe.versions[0];
      await service.replaceComponents(tenantId, variantRecipe.id, variantDraft.id, { expectedRevision: 0, components: [{ inventoryItemId: milk.id, quantity: "300", unit: "ml" }] });
      await service.publish(tenantId, actor.id, variantRecipe.id, variantDraft.id);
      await menuService.updateItem(tenantId, item.id, { variants: [{ id: variant.id, name: "Large", priceToman: 1500, isDefault: true, isAvailable: true, sortOrder: 0 }] });
      await menuService.updateItem(tenantId, item.id, { variants: [] });
      const [stableVariant] = await manager.query(`SELECT id,is_available FROM menu_item_variants WHERE coffee_shop_id=$1 AND item_id=$2`, [tenantId, item.id]);
      assert.equal(stableVariant.id, variant.id);
      assert.equal(stableVariant.is_available, false);
      assert.equal((await service.list(tenantId)).find((row: { recipeId: string | null }) => row.recipeId === variantRecipe.id).isAvailable, false);

      await manager.query(`UPDATE inventory_items SET name='Whole Milk',is_active=false WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, milk.id]);
      const next = await service.createVersion(tenantId, actor.id, initial.id);
      assert.equal(next.versionNumber, 2);
      assert.equal(next.components.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk.id).inventoryItemName, "Milk");
      const changed = await service.replaceComponents(tenantId, initial.id, next.id, { expectedRevision: 0, components: [{ inventoryItemId: coffee.id, quantity: "20", unit: "g" }, { inventoryItemId: milk.id, quantity: "210", unit: "ml" }] });
      assert.equal(changed.components.length, 2);
      const updated = await service.publish(tenantId, actor.id, initial.id, next.id);
      assert.deepEqual(updated.versions.map((version: { status: string }) => version.status), ["ACTIVE", "SUPERSEDED"]);
      assert.equal(addQuantities(updated.versions[1].components.find((line: { inventoryItemId: string }) => line.inventoryItemId === coffee.id).quantity), "18");
      assert.equal(addQuantities(updated.versions[0].components.find((line: { inventoryItemId: string }) => line.inventoryItemId === coffee.id).quantity), "20");
      assert.equal(updated.versions[1].components.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk.id).inventoryItemName, "Milk");
      assert.equal((await service.resolveActiveRecipe(tenantId, item.id)).recipeVersionId, next.id);
      assert.equal((await service.resolveActiveRecipe(tenantId, item.id, variant.id)).recipeVersionId, variantDraft.id);
      await assert.rejects(service.get(otherTenantId, initial.id), /Recipe not found/);

      const emptyDraft = await service.createVersion(tenantId, actor.id, initial.id);
      await service.replaceComponents(tenantId, initial.id, emptyDraft.id, { expectedRevision: 0, components: [] });
      await assert.rejects(service.publish(tenantId, actor.id, initial.id, emptyDraft.id), BadRequestException);
      const [activeCount] = await manager.query(`SELECT count(*)::int AS count FROM inventory_recipe_versions WHERE coffee_shop_id=$1 AND recipe_id=$2 AND status='ACTIVE'`, [tenantId, initial.id]);
      assert.equal(activeCount.count, 1);

      const duplicate = await service.duplicate(tenantId, actor.id, initial.id, { menuItemId: copyItem.id });
      assert.equal(duplicate.versions[0].status, "DRAFT");
      assert.equal(duplicate.versions[0].components.length, 2);
      const [movementCount] = await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`, [tenantId]);
      assert.equal(movementCount.count, 0);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await db.destroy(); }
});
