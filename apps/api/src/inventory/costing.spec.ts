import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ForbiddenException, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { InventoryDimension } from "./entities";
import { MenuProfitabilityQueryDto } from "./costing.dto";
import { RecipeCostingService } from "./costing.service";
import { RecipesService } from "./recipes.service";

const canonical = (value: string | null) => {
  if (value === null) return null;
  const [whole, fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
};

test("costing query validates bounded, allow-listed controls", () => {
  assert.ok(validateSync(plainToInstance(MenuProfitabilityQueryDto, { limit: 101 })).length);
  assert.ok(validateSync(plainToInstance(MenuProfitabilityQueryDto, { sortBy: "price; DROP TABLE menu_items" })).length);
  assert.equal(validateSync(plainToInstance(MenuProfitabilityQueryDto, { page: "2", limit: "50", includeUnavailable: "true", sortBy: "grossMargin" })).length, 0);
});

test("costing checks Inventory entitlement before database access", async () => {
  let queried = false;
  const service = new RecipeCostingService({ query: async () => { queried = true; return []; } } as never, { requireFeature: async () => { throw new ForbiddenException(); } } as never);
  await assert.rejects(service.menuProfitability("tenant", {}), ForbiddenException);
  assert.equal(queried, false);
});

test("current costing uses normalized quantities, default-location average cost and menu variant prices", { skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL, entities: [CoffeeShop, Branch, Domain, MenuCategory, MenuItem, MenuItemVariant] });
  await db.initialize();
  const rollback = new Error(`rollback costing ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [actor] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actor?.id, "integration database needs one administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Costing Test',$2,'ACTIVE'),($3,'Other Costing Test',$4,'ACTIVE')`, [tenantId, `cost-${tenantId}`, otherTenantId, `cost-${otherTenantId}`]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Drinks') RETURNING id`, [tenantId]);
      const [otherCategory] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Other') RETURNING id`, [otherTenantId]);
      const adapter = {
        manager,
        query: (sql: string, params?: unknown[]) => manager.query(sql, params),
        transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
      } as unknown as DataSource;
      const subscriptions = { requireFeature: async () => undefined };
      const recipes = new RecipesService(adapter, subscriptions as never);
      const costing = new RecipeCostingService(adapter, subscriptions as never);
      const [location] = await manager.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default) VALUES($1,'Main',true) RETURNING id`, [tenantId]);
      const addItem = async (name: string, dimension: InventoryDimension, unit: string, cost: string | null) => {
        const [item] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,$2,$3,$4) RETURNING id`, [tenantId, name, dimension, unit]);
        if (cost !== null) await manager.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id,average_unit_cost_toman) VALUES($1,$2,$3,$4)`, [tenantId, item.id, location.id, cost]);
        return item.id as string;
      };
      const coffee = await addItem("Coffee", InventoryDimension.Weight, "g", "1600");
      const milk = await addItem("Milk", InventoryDimension.Volume, "ml", "75");
      const cup = await addItem("Cup", InventoryDimension.Count, "piece", "5000");
      const lid = await addItem("Lid", InventoryDimension.Count, "piece", "2000");
      const water = await addItem("Tap water", InventoryDimension.Volume, "ml", "0");
      const ice = await addItem("Ice", InventoryDimension.Weight, "g", null);

      const menuItem = async (name: string, price: string | null, targetCategory = category.id) => {
        const [item] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,$3,$4) RETURNING id`, [tenantId, targetCategory, name, price]);
        return item.id as string;
      };
      const latte = await menuItem("Latte", "150000");
      const missing = await menuItem("Iced Latte", "90000");
      const noCost = await menuItem("Water", "10000");
      const zeroCost = await menuItem("Water Shot", "30000");
      const free = await menuItem("Free Sample", "0");
      const noRecipe = await menuItem("No Recipe", "12000");
      const noActiveVersion = await menuItem("Unpublished Recipe", "24000");
      const variantMenu = await menuItem("Size Menu", "999999");
      const [otherMenuRow] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Other Tenant Item',1) RETURNING id`, [otherTenantId, otherCategory.id]);
      const otherMenu = otherMenuRow.id as string;
      const [small] = await manager.query(`INSERT INTO menu_item_variants(coffee_shop_id,item_id,name,price_toman) VALUES($1,$2,'Small',100000) RETURNING id`, [tenantId, variantMenu]);
      const [large] = await manager.query(`INSERT INTO menu_item_variants(coffee_shop_id,item_id,name,price_toman) VALUES($1,$2,'Large',200000) RETURNING id`, [tenantId, variantMenu]);
      const addRecipe = async (itemId: string, components: Array<{ id: string; quantity: string; unit: string }>, variantId?: string) => {
        const recipe = await recipes.create(tenantId, actor.id, { menuItemId: itemId, menuItemVariantId: variantId });
        const draft = recipe.versions[0];
        await recipes.replaceComponents(tenantId, recipe.id, draft.id, { expectedRevision: 0, components: components.map((line) => ({ inventoryItemId: line.id, quantity: line.quantity, unit: line.unit })) });
        await recipes.publish(tenantId, actor.id, recipe.id, draft.id);
        return { recipeId: recipe.id, versionId: draft.id };
      };
      const latteRecipe = await addRecipe(latte, [
        { id: coffee, quantity: "18", unit: "g" }, { id: milk, quantity: "0.22", unit: "l" },
        { id: cup, quantity: "1", unit: "piece" }, { id: lid, quantity: "1", unit: "piece" },
      ]);
      await addRecipe(missing, [{ id: coffee, quantity: "18", unit: "g" }, { id: ice, quantity: "150", unit: "g" }]);
      await addRecipe(noCost, [{ id: ice, quantity: "100", unit: "g" }]);
      const zeroRecipe = await addRecipe(zeroCost, [{ id: water, quantity: "250", unit: "ml" }]);
      await addRecipe(free, [{ id: coffee, quantity: "10", unit: "g" }]);
      const fallbackRecipe = await addRecipe(variantMenu, [{ id: coffee, quantity: "0.018", unit: "kg" }]);
      await addRecipe(variantMenu, [{ id: coffee, quantity: "10", unit: "g" }], small.id);
      await recipes.create(tenantId, actor.id, { menuItemId: noActiveVersion });
      await manager.query(`UPDATE menu_items SET is_available=false WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, noRecipe]);

      const latteCost = await costing.recipeCost(tenantId, latteRecipe.recipeId);
      assert.equal(latteCost.costSemantics, "CURRENT_COST_ESTIMATE");
      assert.equal(latteCost.costBasis, "CURRENT_LOCATION_AVERAGE_COST");
      assert.equal(latteCost.costLocation?.id, location.id);
      assert.equal(latteCost.costStatus, "COMPLETE");
      assert.equal(canonical(latteCost.recipeCostToman), "52300");
      assert.equal(canonical(latteCost.grossProfitToman), "97700");
      assert.equal(latteCost.grossMarginPercent, "65.13");
      assert.equal(latteCost.materialCostPercent, "34.87");
      assert.equal(latteCost.components.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk).normalizedQuantity, "220.000000");
      assert.equal(canonical(latteCost.components.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk).componentCostToman), "16500");

      const incomplete = await costing.recipeCost(tenantId, (await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND menu_item_id=$2`, [tenantId, missing]))[0].id);
      assert.equal(incomplete.costStatus, "INCOMPLETE");
      assert.equal(canonical(incomplete.totalKnownCostToman), "28800");
      assert.equal(incomplete.recipeCostToman, null);
      assert.equal(incomplete.grossMarginPercent, null);
      assert.deepEqual(incomplete.missingCostItems.map((line: { inventoryItemName: string }) => line.inventoryItemName), ["Ice"]);
      const unavailable = await costing.recipeCost(tenantId, (await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND menu_item_id=$2`, [tenantId, noCost]))[0].id);
      assert.equal(unavailable.costStatus, "NO_COST_DATA");
      assert.equal(unavailable.recipeCostToman, null);
      const zero = await costing.recipeCost(tenantId, zeroRecipe.recipeId);
      assert.equal(zero.costStatus, "COMPLETE");
      assert.equal(canonical(zero.recipeCostToman), "0");
      assert.equal(zero.components[0].costAvailable, true);
      const freeCost = await costing.recipeCost(tenantId, (await manager.query(`SELECT id FROM inventory_recipes WHERE coffee_shop_id=$1 AND menu_item_id=$2`, [tenantId, free]))[0].id);
      assert.equal(canonical(freeCost.grossProfitToman), "-16000");
      assert.equal(freeCost.grossMarginPercent, null);
      assert.equal(freeCost.materialCostPercent, null);

      const menu = await costing.menuProfitability(tenantId, { limit: 100 });
      assert.equal(menu.total, 8);
      assert.deepEqual(menu.categories.map((entry) => entry.id), [category.id]);
      assert.equal((await costing.menuProfitability(tenantId, { categoryId: otherCategory.id })).total, 0);
      const allMenu = await costing.menuProfitability(tenantId, { limit: 100, includeUnavailable: true });
      assert.equal(allMenu.total, 9);
      const menuRows = allMenu.items as unknown as Array<{ menuItemId: string; menuItemVariantId: string | null; sellingPriceToman: string | null; recipeCostToman: string | null; recipeFallback: string | null; costStatus: string }>;
      assert.equal(menuRows.some((item) => item.menuItemId === variantMenu && item.menuItemVariantId === null), false);
      const smallRow = menuRows.find((item) => item.menuItemVariantId === small.id);
      const largeRow = menuRows.find((item) => item.menuItemVariantId === large.id);
      assert.ok(smallRow);
      assert.ok(largeRow);
      assert.equal(smallRow.sellingPriceToman, "100000");
      assert.equal(canonical(smallRow.recipeCostToman), "16000");
      assert.equal(largeRow.sellingPriceToman, "200000");
      assert.equal(largeRow.recipeFallback, "MENU_ITEM");
      assert.equal(canonical(largeRow.recipeCostToman), "28800");
      assert.equal(menuRows.find((item) => item.menuItemId === latte)?.costStatus, "COMPLETE");
      assert.equal(menuRows.find((item) => item.menuItemId === missing)?.costStatus, "INCOMPLETE");
      assert.equal(menuRows.find((item) => item.menuItemId === noCost)?.costStatus, "NO_COST_DATA");
      assert.equal(menuRows.find((item) => item.menuItemId === noRecipe)?.costStatus, "NOT_CONFIGURED");
      assert.equal(menuRows.find((item) => item.menuItemId === noActiveVersion)?.costStatus, "NO_ACTIVE_VERSION");
      assert.equal(menu.items.some((item: { menuItemId: string }) => item.menuItemId === noRecipe), false);
      assert.equal(menuRows.find((item) => item.menuItemId === otherMenu), undefined);
      assert.equal((await costing.menuProfitability(tenantId, { search: "Small", costingStatus: "COMPLETE" })).total, 1);
      assert.equal((await costing.menuProfitability(tenantId, { page: 2, limit: 1 })).items.length, 1);

      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=1700 WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, coffee, location.id]);
      const refreshed = await costing.recipeCost(tenantId, latteRecipe.recipeId);
      assert.equal(canonical(refreshed.recipeCostToman), "54100");
      assert.equal((await costing.recipeCost(tenantId, fallbackRecipe.recipeId, fallbackRecipe.versionId)).costSemantics, "CURRENT_COST_ESTIMATE");
      await assert.rejects(costing.recipeCost(otherTenantId, latteRecipe.recipeId), NotFoundException);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await db.destroy(); }
});
