import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { ConflictException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { Client, ClientAddress } from "../clients/entities";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { CoffeeShopMembership, MembershipRole, Permission, Role, RolePermission, User, UserPlatformRole } from "../identity/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { OnlineOrderingSettings, Order, OrderDeliveryMethod, OrderPaymentMethod, OrderSource, OrderStatus } from "../ordering/entities";
import { OrderItem } from "../ordering/entities/order-item.entity";
import { OrderingService } from "../ordering/ordering.service";
import { InventoryDimension, InventoryWasteReason } from "./entities";
import { InventoryService } from "./inventory.service";
import { RecipesService } from "./recipes.service";
import { multiplyQuantity } from "./quantity.util";

test("order quantity multiplication stays exact", () => {
  assert.equal(multiplyQuantity("0.1", 3), "0.3");
  assert.equal(multiplyQuantity("18.125", 3), "54.375");
  assert.throws(() => multiplyQuantity("1", 1.5));
});

test("accepted orders consume the applied recipe once and cancellation reverses its original movements", { skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL, entities: [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, MembershipRole, Permission, Role, RolePermission, UserPlatformRole, Client, ClientAddress, MenuCategory, MenuItem, MenuItemVariant, OnlineOrderingSettings, Order, OrderItem] });
  await db.initialize();
  const rollback = new Error(`rollback order inventory ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [actor] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actor?.id, "integration database needs one administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Order Inventory Test',$2,'ACTIVE'),($3,'Other Inventory Test',$4,'ACTIVE')`, [tenantId, `order-inv-${tenantId}`, otherTenantId, `order-inv-${otherTenantId}`]);
      const [client] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone) VALUES($1,'Test','Client','+989120000001') RETURNING id`, [tenantId]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Drinks') RETURNING id`, [tenantId]);
      const [latte] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Latte',1000) RETURNING id`, [tenantId, category.id]);
      const [large] = await manager.query(`INSERT INTO menu_item_variants(coffee_shop_id,item_id,name,price_toman) VALUES($1,$2,'Large',1500) RETURNING id`, [tenantId, latte.id]);
      const [gift] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Gift Card',500) RETURNING id`, [tenantId, category.id]);
      const [broken] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Broken Recipe',500) RETURNING id`, [tenantId, category.id]);
      const adapter = {
        manager,
        query: (sql: string, params?: unknown[]) => manager.query(sql, params),
        transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager),
        getRepository: manager.getRepository.bind(manager),
      } as unknown as DataSource;
      const enabledSubscriptions = { requireFeature: async () => undefined, featureState: async () => ({ enabled: true }) };
      const recipes = new RecipesService(adapter, enabledSubscriptions as never);
      const inventory = new InventoryService(adapter, enabledSubscriptions as never, recipes);
      const ordering = new OrderingService(adapter, enabledSubscriptions as never, { enqueue: async () => undefined } as never, inventory);
      const location = await inventory.createLocation(tenantId, { name: "Main", isDefault: true });
      const coffee = await inventory.createItem(tenantId, actor.id, { name: "Coffee", dimension: InventoryDimension.Weight, baseUnit: "g", locationId: location.id, openingQuantity: "1000" });
      const milk = await inventory.createItem(tenantId, actor.id, { name: "Milk", dimension: InventoryDimension.Volume, baseUnit: "ml", locationId: location.id, openingQuantity: "1000" });
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=CASE WHEN item_id=$2 THEN 1600 ELSE 75 END WHERE coffee_shop_id=$1 AND item_id=ANY($3::uuid[]) AND location_id=$4`, [tenantId, coffee.id, [coffee.id, milk.id], location.id]);

      const addRecipe = async (menuItemId: string, variantId: string | null, coffeeQty: string, milkQty: string) => {
        const recipe = await recipes.create(tenantId, actor.id, { menuItemId, menuItemVariantId: variantId });
        const draft = recipe.versions[0];
        await recipes.replaceComponents(tenantId, recipe.id, draft.id, { expectedRevision: 0, components: [
          { inventoryItemId: coffee.id, quantity: coffeeQty, unit: "g" },
          { inventoryItemId: milk.id, quantity: milkQty, unit: "ml" },
        ] });
        await recipes.publish(tenantId, actor.id, recipe.id, draft.id);
        return { recipeId: recipe.id, versionId: draft.id };
      };
      const baseV1 = await addRecipe(latte.id, null, "18", "220");
      const variantRecipe = await addRecipe(latte.id, large.id, "32", "260");
      const noActive = await recipes.create(tenantId, actor.id, { menuItemId: broken.id });

      const createOrder = async (key: string, lines: Array<{ item: string; variant?: string; name: string; quantity: number }>) => {
        const [order] = await manager.query(`INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,idempotency_key) VALUES($1,$2,'UNDER_REVIEW','OFFLINE','PICKUP',0,$3) RETURNING id`, [tenantId, client.id, key]);
        for (const line of lines) await manager.query(`INSERT INTO order_items(coffee_shop_id,order_id,menu_item_id,menu_item_variant_id,item_name,variant_name,unit_price_toman,quantity,line_total_toman) VALUES($1,$2,$3,$4,$5,$6,0,$7,0)`, [tenantId, order.id, line.item, line.variant ?? null, line.name, line.variant ? "Large" : null, line.quantity]);
        return order.id as string;
      };

      const clientCheckout = await ordering.createOrder(tenantId, client.id, {
        items: [{ menuItemId: gift.id, quantity: 2 }], deliveryMethod: OrderDeliveryMethod.Pickup,
        paymentMethod: OrderPaymentMethod.Offline, idempotencyKey: `checkout-${randomUUID()}`,
      });
      const [checkoutSource] = await manager.query(`SELECT order_source::text AS source FROM orders WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, clientCheckout.id]);
      assert.equal(checkoutSource.source, OrderSource.PublicClient);

      const orderA = await createOrder(`order-a-${randomUUID()}`, [{ item: latte.id, name: "Latte", quantity: 2 }, { item: gift.id, name: "Gift Card", quantity: 1 }]);
      const acceptedA = await ordering.updateStatus(tenantId, orderA, actor.id, OrderStatus.Preparing);
      assert.equal(acceptedA.status, OrderStatus.Preparing);
      const appliedA = await manager.query(`SELECT id,item_id AS "itemId",order_item_id AS "orderItemId",recipe_version_id AS "recipeVersionId",actor_user_id AS "actorUserId",quantity_base::text AS quantity,unit_cost_toman::text AS "unitCostToman",total_cost_toman::text AS "totalCostToman" FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND source_type='ORDER_CONSUMPTION' ORDER BY item_id`, [tenantId, orderA]);
      assert.equal(appliedA.length, 2);
      assert.ok(appliedA.every((movement: { recipeVersionId: string }) => movement.recipeVersionId === baseV1.versionId));
      assert.ok(appliedA.every((movement: { actorUserId: string }) => movement.actorUserId === actor.id));
      assert.deepEqual(appliedA.map((movement: { quantity: string }) => movement.quantity).sort(), ["-36.000000", "-440.000000"]);
      const coffeeCost = appliedA.find((movement: { itemId: string }) => movement.itemId === coffee.id);
      const milkCost = appliedA.find((movement: { itemId: string }) => movement.itemId === milk.id);
      assert.equal(coffeeCost.unitCostToman, "1600.000000");
      assert.equal(coffeeCost.totalCostToman, "57600");
      assert.equal(milkCost.unitCostToman, "75.000000");
      assert.equal(milkCost.totalCostToman, "33000");
      assert.equal((await inventory.consumeOrder(manager, tenantId, orderA, actor.id)).duplicate, true);
      await assert.rejects(ordering.updateStatus(tenantId, orderA, actor.id, OrderStatus.Preparing), /Invalid order status transition/);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION'`, [tenantId, orderA]))[0].count, 2);
      await manager.query(`SAVEPOINT duplicate_consumption_guard`);
      await assert.rejects(manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,order_item_id,recipe_version_id,recipe_component_id,idempotency_key) SELECT coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,order_item_id,recipe_version_id,recipe_component_id,'duplicate:'||id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION' LIMIT 1`, [tenantId, orderA]));
      await manager.query(`ROLLBACK TO SAVEPOINT duplicate_consumption_guard`);

      const next = await recipes.createVersion(tenantId, actor.id, baseV1.recipeId);
      await recipes.replaceComponents(tenantId, baseV1.recipeId, next.id, { expectedRevision: 0, components: [
        { inventoryItemId: coffee.id, quantity: "20", unit: "g" }, { inventoryItemId: milk.id, quantity: "210", unit: "ml" },
      ] });
      await recipes.publish(tenantId, actor.id, baseV1.recipeId, next.id);
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=NULL WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]);
      const orderB = await createOrder(`order-b-${randomUUID()}`, [{ item: latte.id, name: "Latte", quantity: 1 }]);
      await ordering.updateStatus(tenantId, orderB, actor.id, OrderStatus.Preparing);
      assert.deepEqual((await manager.query(`SELECT DISTINCT recipe_version_id AS id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION'`, [tenantId, orderB])).map((row: { id: string }) => row.id), [next.id]);
      const unknownMilk = (await manager.query(`SELECT unit_cost_toman AS cost,total_cost_toman AS total FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION' AND item_id=$3`, [tenantId, orderB, milk.id]))[0];
      assert.deepEqual(unknownMilk, { cost: null, total: null });
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=75 WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]);
      const orderC = await createOrder(`order-c-${randomUUID()}`, [{ item: latte.id, variant: large.id, name: "Latte Large", quantity: 2 }]);
      await ordering.updateStatus(tenantId, orderC, actor.id, OrderStatus.Preparing);
      const versions = await manager.query(`SELECT DISTINCT recipe_version_id AS id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION'`, [tenantId, orderC]);
      assert.deepEqual(versions.map((row: { id: string }) => row.id), [variantRecipe.versionId]);

      await ordering.updateStatus(tenantId, orderA, actor.id, OrderStatus.Canceled);
      await assert.rejects(ordering.updateStatus(tenantId, orderA, actor.id, OrderStatus.Canceled), /Invalid order status transition/);
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=999 WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, coffee.id, location.id]);
      const reversals = await manager.query(`SELECT reversal_of_movement_id AS "reverses",quantity_base::text AS quantity,unit_cost_toman::text AS "unitCostToman",total_cost_toman AS "totalCostToman" FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_REVERSAL' ORDER BY item_id`, [tenantId, orderA]);
      assert.equal(reversals.length, 2);
      assert.deepEqual(reversals.map((movement: { quantity: string }) => movement.quantity).sort(), ["36.000000", "440.000000"]);
      assert.deepEqual(new Set(reversals.map((movement: { reverses: string }) => movement.reverses)), new Set(appliedA.map((movement: { id: string }) => movement.id)));
      for (const reversal of reversals) {
        const original = appliedA.find((movement: { id: string }) => movement.id === reversal.reverses);
        assert.equal(reversal.unitCostToman, original.unitCostToman);
        assert.equal(reversal.totalCostToman, original.totalCostToman);
      }
      await inventory.reverseOrder(manager, tenantId, orderA, actor.id);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_REVERSAL'`, [tenantId, orderA]))[0].count, 2);
      await manager.query(`SAVEPOINT duplicate_reversal_guard`);
      await assert.rejects(manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id,idempotency_key) SELECT coffee_shop_id,item_id,location_id,'SALE_REVERSAL',-quantity_base,'ORDER_REVERSAL',source_id,order_item_id,recipe_version_id,recipe_component_id,id,'duplicate-reversal:'||id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION' LIMIT 1`, [tenantId, orderA]));
      await manager.query(`ROLLBACK TO SAVEPOINT duplicate_reversal_guard`);
      await manager.query(`SAVEPOINT immutable_sale_cost`);
      await assert.rejects(manager.query(`UPDATE inventory_stock_movements SET unit_cost_toman=999 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, coffeeCost.id]));
      await manager.query(`ROLLBACK TO SAVEPOINT immutable_sale_cost`);

      const canceledEarly = await createOrder(`order-early-${randomUUID()}`, [{ item: latte.id, name: "Latte", quantity: 1 }]);
      await ordering.updateStatus(tenantId, canceledEarly, actor.id, OrderStatus.Canceled);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2`, [tenantId, canceledEarly]))[0].count, 0);
      assert.equal((await recipes.resolveActiveRecipe(otherTenantId, latte.id)), null);

      const disabledSubscriptions = { requireFeature: async () => undefined, featureState: async () => ({ enabled: false }) };
      const disabledInventory = new InventoryService(adapter, disabledSubscriptions as never, recipes);
      const disabledOrdering = new OrderingService(adapter, {} as never, { enqueue: async () => undefined } as never, disabledInventory);
      const disabledOrder = await createOrder(`order-disabled-${randomUUID()}`, [{ item: latte.id, name: "Latte", quantity: 1 }]);
      await disabledOrdering.updateStatus(tenantId, disabledOrder, actor.id, OrderStatus.Preparing);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2`, [tenantId, disabledOrder]))[0].count, 0);

      const brokenOrder = await createOrder(`order-broken-${randomUUID()}`, [{ item: broken.id, name: "Broken Recipe", quantity: 1 }]);
      await assert.rejects(ordering.updateStatus(tenantId, brokenOrder, actor.id, OrderStatus.Preparing), error => error instanceof ConflictException);
      assert.equal((await manager.query(`SELECT status FROM orders WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, brokenOrder]))[0].status, OrderStatus.UnderReview);
      assert.equal(noActive.versions[0].status, "DRAFT");

      const failedOrder = await createOrder(`order-fail-${randomUUID()}`, [{ item: latte.id, name: "Latte", quantity: 1 }]);
      const failingItemId = [coffee.id, milk.id].sort()[1];
      await manager.query(`CREATE FUNCTION fail_order_inventory_component() RETURNS trigger AS $$ BEGIN IF NEW.source_type='ORDER_CONSUMPTION' AND NEW.source_id='${failedOrder}' AND NEW.item_id='${failingItemId}'::uuid THEN RAISE EXCEPTION 'injected inventory failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await manager.query(`CREATE TRIGGER fail_order_inventory_component BEFORE INSERT ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION fail_order_inventory_component()`);
      await manager.query(`SAVEPOINT order_inventory_atomicity`);
      await assert.rejects(ordering.updateStatus(tenantId, failedOrder, actor.id, OrderStatus.Preparing), /injected inventory failure/);
      await manager.query(`ROLLBACK TO SAVEPOINT order_inventory_atomicity`);
      assert.equal((await manager.query(`SELECT status FROM orders WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, failedOrder]))[0].status, OrderStatus.UnderReview);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2`, [tenantId, failedOrder]))[0].count, 0);
      await manager.query(`DROP TRIGGER fail_order_inventory_component ON inventory_stock_movements`);
      await manager.query(`DROP FUNCTION fail_order_inventory_component()`);

      const balances = await manager.query(`SELECT item_id AS id,quantity_base::text AS quantity FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND location_id=$2 ORDER BY item_id`, [tenantId, location.id]);
      assert.equal(balances.find((row: { id: string }) => row.id === coffee.id).quantity, "916.000000");
      assert.equal(balances.find((row: { id: string }) => row.id === milk.id).quantity, "270.000000");

      const [{ today }] = await manager.query(`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Tehran')::date,'YYYY-MM-DD') AS today`);
      const localDay = (offset: number) => { const date = new Date(`${today}T12:00:00.000Z`); date.setUTCDate(date.getUTCDate()+offset); return date.toISOString().slice(0,10); };
      const tracked = await inventory.createItem(tenantId, actor.id, {
        name: "Batch Milk", dimension: InventoryDimension.Volume, baseUnit: "ml", locationId: location.id,
        openingQuantity: "400", batchTrackingEnabled: true, expiryTrackingEnabled: true,
        openingBatches: [
          { supplierLotNumber: "EXPIRED", quantity: "100", expiryDate: localDay(-1) },
          { supplierLotNumber: "EARLY", quantity: "100", expiryDate: localDay(1) },
          { supplierLotNumber: "LATE", quantity: "200", expiryDate: localDay(2) },
        ],
      });
      const trackedBatches = await manager.query(`SELECT id,supplier_lot_number AS lot FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2`, [tenantId, tracked.id]);
      const batchIds = Object.fromEntries(trackedBatches.map((batch: { id: string; lot: string }) => [batch.lot,batch.id])) as Record<string,string>;
      const [lotAlert] = await manager.query(`SELECT id,alert_type AS type FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND batch_id=$2 AND status='OPEN'`,[tenantId,batchIds.LATE]);
      assert.equal(lotAlert.type,"BATCH_EXPIRING_SOON");
      const [batchDrink] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name,base_price_toman) VALUES($1,$2,'Batch Drink',1000) RETURNING id`, [tenantId, category.id]);
      const trackedRecipe = await recipes.create(tenantId, actor.id, { menuItemId: batchDrink.id });
      await recipes.replaceComponents(tenantId, trackedRecipe.id, trackedRecipe.versions[0].id, { expectedRevision: 0, components: [{ inventoryItemId: tracked.id, quantity: "250", unit: "ml" }] });
      await recipes.publish(tenantId, actor.id, trackedRecipe.id, trackedRecipe.versions[0].id);
      const trackedOrder = await createOrder(`order-batches-${randomUUID()}`, [{ item: batchDrink.id, name: "Batch Drink", quantity: 1 }]);
      await ordering.updateStatus(tenantId, trackedOrder, actor.id, OrderStatus.Preparing);
      const batchConsumption = await manager.query(`SELECT b.supplier_lot_number AS lot,m.quantity_base::text AS quantity,m.batch_id AS "batchId" FROM inventory_stock_movements m JOIN inventory_batches b ON b.coffee_shop_id=m.coffee_shop_id AND b.id=m.batch_id WHERE m.coffee_shop_id=$1 AND m.source_id=$2 AND m.type='SALE_CONSUMPTION' AND m.item_id=$3 ORDER BY b.expiry_date`, [tenantId, trackedOrder, tracked.id]);
      assert.deepEqual(batchConsumption.map((row: { lot: string; quantity: string }) => [row.lot,row.quantity]), [["EARLY","-100.000000"],["LATE","-150.000000"]]);
      assert.equal((await manager.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2`, [tenantId,batchIds.EXPIRED]))[0].quantity, "100.000000");
      assert.equal((await inventory.consumeOrder(manager,tenantId,trackedOrder,actor.id)).duplicate, true);
      await assert.rejects(inventory.batch(otherTenantId,batchIds.EARLY!));
      await ordering.updateStatus(tenantId, trackedOrder, actor.id, OrderStatus.Canceled);
      const batchReversals = await manager.query(`SELECT b.supplier_lot_number AS lot,m.quantity_base::text AS quantity,m.batch_id AS "batchId" FROM inventory_stock_movements m JOIN inventory_batches b ON b.coffee_shop_id=m.coffee_shop_id AND b.id=m.batch_id WHERE m.coffee_shop_id=$1 AND m.source_id=$2 AND m.type='SALE_REVERSAL' AND m.item_id=$3 ORDER BY b.expiry_date`, [tenantId, trackedOrder, tracked.id]);
      assert.deepEqual(batchReversals.map((row: { lot: string; quantity: string }) => [row.lot,row.quantity]), [["EARLY","100.000000"],["LATE","150.000000"]]);
      await inventory.updateBatch(tenantId,actor.id,batchIds.LATE!,{expiryDate:localDay(-1),reason:"Correct supplier date"});
      const [transitionedAlert] = await manager.query(`SELECT id,alert_type AS type FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND batch_id=$2 AND status='OPEN'`,[tenantId,batchIds.LATE]);
      assert.deepEqual(transitionedAlert,{id:lotAlert.id,type:"BATCH_EXPIRED"});

      const excessAdjustment = { itemId: tracked.id, locationId: location.id, batchId: batchIds.EARLY, quantity: "-101", reason: "Overdraw guard", idempotencyKey: `batch-overdraw:${randomUUID()}` };
      await assert.rejects(inventory.adjust(tenantId,actor.id,excessAdjustment), error => error instanceof ConflictException);
      const excessWaste = await inventory.createWasteRecord(tenantId,actor.id,{ locationId: location.id, reason: InventoryWasteReason.Expired, items: [{ inventoryItemId: tracked.id, batchId: batchIds.EXPIRED, quantity: "101", unit: "ml" }] });
      await assert.rejects(inventory.postWasteRecord(tenantId,actor.id,excessWaste.id), error => error instanceof ConflictException);
      const waste = await inventory.createWasteRecord(tenantId,actor.id,{ locationId: location.id, reason: InventoryWasteReason.Expired, items: [{ inventoryItemId: tracked.id, batchId: batchIds.EXPIRED, quantity: "10", unit: "ml" }] });
      const postedWaste = await inventory.postWasteRecord(tenantId,actor.id,waste.id);
      assert.equal(postedWaste.items[0].batchId,batchIds.EXPIRED);

      const count = await inventory.createCount(tenantId,actor.id,{locationId:location.id});
      await inventory.saveCountLines(tenantId,count.id,{lines:[
        {itemId:tracked.id,batchId:batchIds.EXPIRED,allocationType:"BATCH",countedQuantity:"88"},
        {itemId:tracked.id,batchId:batchIds.EARLY,allocationType:"BATCH",countedQuantity:"100"},
        {itemId:tracked.id,batchId:batchIds.LATE,allocationType:"BATCH",countedQuantity:"200"},
        {itemId:tracked.id,allocationType:"UNALLOCATED",countedQuantity:"0"},
      ]});
      await inventory.adjust(tenantId,actor.id,{itemId:tracked.id,locationId:location.id,batchId:batchIds.EXPIRED,quantity:"-2",reason:"Post-count movement",idempotencyKey:`batch-count:${randomUUID()}`});
      const completed = await inventory.completeCount(tenantId,actor.id,count.id);
      assert.equal(completed.lines.find((line: { batchId: string|null })=>line.batchId===batchIds.EXPIRED).varianceQuantity,"-2.000000");
      assert.equal((await manager.query(`SELECT remaining_quantity_base::text AS quantity FROM inventory_batches WHERE coffee_shop_id=$1 AND id=$2`,[tenantId,batchIds.EXPIRED]))[0].quantity,"86.000000");
      await inventory.adjust(tenantId,actor.id,{itemId:tracked.id,locationId:location.id,batchId:batchIds.EARLY,quantity:"-100",reason:"Deplete corrected lot",idempotencyKey:`batch-deplete:${randomUUID()}`});
      await inventory.adjust(tenantId,actor.id,{itemId:tracked.id,locationId:location.id,batchId:batchIds.EXPIRED,quantity:"-86",reason:"Deplete expired lot",idempotencyKey:`batch-deplete:${randomUUID()}`});
      const resolvedAlerts = await manager.query(`SELECT batch_id AS "batchId",status FROM inventory_stock_alerts WHERE coffee_shop_id=$1 AND batch_id=ANY($2::uuid[])`,[tenantId,[batchIds.EARLY,batchIds.EXPIRED]]);
      assert.ok(resolvedAlerts.every((row:{status:string})=>row.status==="RESOLVED"));

      await manager.query(`SAVEPOINT bad_reversal_guard`);
      await assert.rejects(manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id,idempotency_key) SELECT coffee_shop_id,item_id,location_id,'SALE_REVERSAL',1,'ORDER_REVERSAL',source_id,order_item_id,recipe_version_id,recipe_component_id,id,'bad-reversal:'||id FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='SALE_CONSUMPTION' LIMIT 1`, [tenantId, orderA]));
      await manager.query(`ROLLBACK TO SAVEPOINT bad_reversal_guard`);
      throw rollback;
    }), error => error === rollback);
  } finally {
    await db.destroy();
  }
});
