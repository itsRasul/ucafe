import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { InventoryDimension } from "./entities";
import { InventoryService } from "./inventory.service";
import { CreateGoodsReceiptDto, CreatePurchaseOrderDto, CreateSupplierDto } from "./purchasing.dto";
import { PurchasingService } from "./purchasing.service";
import { RecipesService } from "./recipes.service";
import { SmartPurchasingService, estimatePurchaseCostToman } from "./smart-purchasing.service";
import { SupplierItemPreferenceDto } from "./smart-purchasing.dto";

test("purchase cost estimates use decimal arithmetic and whole-toman half-up rounding", () => {
  assert.equal(estimatePurchaseCostToman("1560.000000", "500"), "780000");
  assert.equal(estimatePurchaseCostToman("0.5", "1"), "1");
  assert.equal(estimatePurchaseCostToman("0.49", "1"), "0");
});

test("supplier, order and receipt DTOs reject malformed prices, quantities and required lines", () => {
  assert.ok(validateSync(plainToInstance(CreateSupplierDto, { name: "   " })).length);
  assert.ok(validateSync(plainToInstance(CreatePurchaseOrderDto, { supplierId: randomUUID(), items: [{ inventoryItemId: randomUUID(), quantity: "1.0000001", unit: "kg", unitPriceToman: "-1" }] })).length);
  assert.ok(validateSync(plainToInstance(CreateGoodsReceiptDto, { supplierId: randomUUID(), items: [] })).length);
  assert.ok(validateSync(plainToInstance(SupplierItemPreferenceDto, { isPreferred: "true", purchaseUnit: "crate" })).length);
});

test("purchasing is inventory-feature gated before database access", async () => {
  let queried = false;
  const service = new PurchasingService({ query: async () => { queried = true; return []; } } as never, { requireFeature: async () => { throw new ForbiddenException(); } } as never, {} as never);
  await assert.rejects(service.suppliers("tenant", { page: 1, limit: 50 }), ForbiddenException);
  assert.equal(queried, false);
  const smartPurchasing = new SmartPurchasingService({ query: async () => { queried = true; return []; } } as never, { requireFeature: async () => { throw new ForbiddenException(); } } as never, {} as never);
  queried = false;
  await assert.rejects(smartPurchasing.replenishment("tenant", { page: 1, limit: 50 }), ForbiddenException);
  assert.equal(queried, false);
});

test("purchase receipts post stock once, preserve actual cost, allow explicit over-receiving and support direct receipt", { skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL, entities: [] });
  await db.initialize();
  const rollback = new Error(`rollback purchasing ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [actor] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actor?.id, "integration database needs one administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Purchasing Test',$2,'ACTIVE'),($3,'Purchasing Other',$4,'ACTIVE')`, [tenantId, `purchasing-${tenantId}`, otherTenantId, `purchasing-${otherTenantId}`]);
      const adapter = {
        manager,
        query: (sql: string, params?: unknown[]) => manager.query(sql, params),
        transaction: async <T>(work: (m: EntityManager) => Promise<T>) => {
          const savepoint = `purchasing_test_${randomUUID().replaceAll("-", "")}`;
          await manager.query(`SAVEPOINT ${savepoint}`);
          try {
            const result = await work(manager);
            await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
            return result;
          } catch (error) {
            await manager.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
            await manager.query(`RELEASE SAVEPOINT ${savepoint}`);
            throw error;
          }
        },
      } as unknown as DataSource;
      const subscriptions = { requireFeature: async () => undefined };
      const recipes = new RecipesService(adapter, subscriptions as never);
      const inventory = new InventoryService(adapter, subscriptions as never, recipes);
      const purchasing = new PurchasingService(adapter, subscriptions as never, inventory);
      const smartPurchasing = new SmartPurchasingService(adapter, subscriptions as never, inventory);
      const location = await inventory.createLocation(tenantId, { name: "Main", isDefault: true });
      const [coffee] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Coffee','WEIGHT','g') RETURNING id`, [tenantId]);
      const [milk] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Milk','VOLUME','ml') RETURNING id`, [tenantId]);
      const [otherCoffee] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Foreign coffee','WEIGHT','g') RETURNING id`, [otherTenantId]);
      const [syrup] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Syrup','VOLUME','ml') RETURNING id`, [tenantId]);
      const [otherSupplier] = await manager.query(`INSERT INTO inventory_suppliers(coffee_shop_id,name) VALUES($1,'Other cafe supplier') RETURNING id`, [otherTenantId]);
      const supplier = await purchasing.createSupplier(tenantId, { name: "Roaster", phone: "+982100000000" });
      await assert.rejects(purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: otherSupplier.id, items: [{ inventoryItemId: coffee.id, quantity: "1", unit: "kg", unitPriceToman: "100" }] }), /Active supplier not found/);
      await assert.rejects(purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: supplier.id, items: [{ inventoryItemId: otherCoffee.id, quantity: "1", unit: "kg", unitPriceToman: "100" }] }), /Inventory item not found/);
      await assert.rejects(purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: supplier.id, items: [{ inventoryItemId: milk.id, quantity: "1", unit: "kg", unitPriceToman: "100" }] }), BadRequestException);

      const order = await purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: supplier.id, expectedDeliveryDate: "2026-10-01", items: [{ inventoryItemId: coffee.id, quantity: "5", unit: "kg", unitPriceToman: "1200000" }] });
      assert.match(order.number, /^PO-\d{6}$/);
      assert.equal(order.estimatedTotalToman, "6000000");
      const [before] = await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`, [tenantId]);
      assert.equal(before.count, 0, "a purchase order must not add stock");
      await manager.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id,quantity_base,average_unit_cost_toman) VALUES($1,$2,$3,'10000','1000')`, [tenantId, coffee.id, location.id]);
      await purchasing.orderPurchaseOrder(tenantId, actor.id, order.id);

      const draft = await purchasing.createGoodsReceipt(tenantId, actor.id, { purchaseOrderId: order.id, supplierId: supplier.id, items: [{ inventoryItemId: coffee.id, quantity: "2", unit: "kg", unitPriceToman: "1300000" }] });
      const [noDraftMovement] = await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`, [tenantId]);
      assert.equal(noDraftMovement.count, 0, "a receipt draft must not add stock");
      await purchasing.postGoodsReceipt(tenantId, actor.id, draft.id, false);
      await purchasing.postGoodsReceipt(tenantId, actor.id, draft.id, false);
      const [balance] = await manager.query(`SELECT quantity_base::text,average_unit_cost_toman::text FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, coffee.id, location.id]);
      assert.equal(balance.quantity_base, "12000.000000");
      assert.equal(balance.average_unit_cost_toman, "1050.000000");
      const [movement] = await manager.query(`SELECT type,source_type,source_id,source_line_id,quantity_base::text,unit_cost_toman::text,total_cost_toman FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='GOODS_RECEIPT'`, [tenantId]);
      assert.equal(movement.type, "PURCHASE_RECEIPT");
      assert.equal(movement.quantity_base, "2000.000000");
      assert.equal(movement.unit_cost_toman, "1300.000000");
      assert.equal(movement.total_cost_toman, "2600000");
      assert.ok(movement.source_line_id);
      assert.equal((await purchasing.purchaseOrder(tenantId, order.id)).items[0].remainingQuantity, "3");

      const over = await purchasing.createGoodsReceipt(tenantId, actor.id, { purchaseOrderId: order.id, items: [{ inventoryItemId: coffee.id, quantity: "4", unit: "kg", unitPriceToman: "1300000" }] });
      await assert.rejects(purchasing.postGoodsReceipt(tenantId, actor.id, over.id, false), ConflictException);
      const overPosted = await purchasing.postGoodsReceipt(tenantId, actor.id, over.id, true);
      assert.equal(overPosted.overReceiveConfirmed, true);
      assert.equal((await purchasing.purchaseOrder(tenantId, order.id)).status, "RECEIVED");
      const [weighted] = await manager.query(`SELECT quantity_base::text,average_unit_cost_toman::text FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, coffee.id, location.id]);
      assert.equal(weighted.quantity_base, "16000.000000");
      assert.equal(weighted.average_unit_cost_toman, "1112.500000");

      const canceledOrder = await purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: supplier.id, items: [{ inventoryItemId: coffee.id, quantity: "1", unit: "kg", unitPriceToman: "1000000" }] });
      await purchasing.orderPurchaseOrder(tenantId, actor.id, canceledOrder.id);
      const partial = await purchasing.createGoodsReceipt(tenantId, actor.id, { purchaseOrderId: canceledOrder.id, items: [{ inventoryItemId: coffee.id, quantity: "0.5", unit: "kg", unitPriceToman: "1300000" }] });
      await purchasing.postGoodsReceipt(tenantId, actor.id, partial.id, false);
      const unposted = await purchasing.createGoodsReceipt(tenantId, actor.id, { purchaseOrderId: canceledOrder.id, items: [{ inventoryItemId: coffee.id, quantity: "0.5", unit: "kg", unitPriceToman: "1300000" }] });
      assert.equal((await purchasing.cancelPurchaseOrder(tenantId, actor.id, canceledOrder.id)).status, "CANCELED");
      assert.equal((await purchasing.goodsReceipt(tenantId, partial.id)).status, "POSTED");
      await assert.rejects(purchasing.goodsReceipt(tenantId, unposted.id), /Goods receipt not found/);

      await manager.query(`INSERT INTO inventory_stock_balances(coffee_shop_id,item_id,location_id,quantity_base) VALUES($1,$2,$3,'-1000')`, [tenantId, syrup.id, location.id]);
      const direct = await purchasing.createGoodsReceipt(tenantId, actor.id, { supplierId: supplier.id, supplierInvoiceNumber: "INV-42", items: [{ inventoryItemId: milk.id, quantity: "2", unit: "l", unitPriceToman: "85000" }, { inventoryItemId: syrup.id, quantity: "1", unit: "l", unitPriceToman: "200000" }] });
      await purchasing.postGoodsReceipt(tenantId, actor.id, direct.id, false);
      const directDetail = await purchasing.goodsReceipt(tenantId, direct.id);
      assert.equal(directDetail.purchaseOrderId, null);
      assert.equal(directDetail.items.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk.id).quantityBase, "2000.000000");
      assert.equal(directDetail.items.find((line: { inventoryItemId: string }) => line.inventoryItemId === milk.id).totalCostToman, "170000");
      const [negativeBalance] = await manager.query(`SELECT quantity_base::text,average_unit_cost_toman::text FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, syrup.id, location.id]);
      assert.equal(negativeBalance.quantity_base, "0.000000");
      assert.equal(negativeBalance.average_unit_cost_toman, "200.000000", "a receipt resets average cost after negative stock");
      await assert.rejects(purchasing.updateGoodsReceipt(tenantId, direct.id, { notes: "change" }), ConflictException);
      const prices = await purchasing.supplierPrices(tenantId, supplier.id, { page: 1, limit: 100 });
      assert.equal(prices.items.find((price: { inventoryItemId: string }) => price.inventoryItemId === coffee.id).unitPriceToman, "1300000");

      const trackedMilk = await inventory.createItem(tenantId,actor.id,{name:"Lot-tracked milk",dimension:InventoryDimension.Volume,baseUnit:"ml",locationId:location.id,batchTrackingEnabled:true,expiryTrackingEnabled:true});
      await assert.rejects(purchasing.createGoodsReceipt(tenantId,actor.id,{supplierId:supplier.id,items:[{inventoryItemId:trackedMilk.id,quantity:"2",unit:"l",unitPriceToman:"100",batches:[{quantity:"0.5",supplierLotNumber:"SHORT-A",expiryDate:"2099-10-01"},{quantity:"0.5",supplierLotNumber:"SHORT-B",expiryDate:"2099-10-02"}]}]}),BadRequestException);
      const batchReceipt = await purchasing.createGoodsReceipt(tenantId,actor.id,{supplierId:supplier.id,items:[{inventoryItemId:trackedMilk.id,quantity:"2",unit:"l",unitPriceToman:"100",batches:[{quantity:"0.5",supplierLotNumber:"LOT-A",manufacturedDate:"2099-09-01",expiryDate:"2099-10-01"},{quantity:"1.5",supplierLotNumber:"LOT-B",manufacturedDate:"2099-09-02",expiryDate:"2099-10-02"}]}]});
      const postedBatchReceipt = await purchasing.postGoodsReceipt(tenantId,actor.id,batchReceipt.id,false);
      assert.equal(postedBatchReceipt.items[0].batches.length,2);
      const receiptBatches = await manager.query(`SELECT supplier_lot_number AS lot,original_quantity_base::text AS original,remaining_quantity_base::text AS remaining,unit_cost_toman::text AS cost,total_cost_toman::text AS total FROM inventory_batches WHERE coffee_shop_id=$1 AND item_id=$2 ORDER BY supplier_lot_number`,[tenantId,trackedMilk.id]);
      assert.deepEqual(receiptBatches.map((row: {lot:string;original:string;remaining:string;cost:string;total:string})=>[row.lot,row.original,row.remaining,row.cost,row.total]),[["LOT-A","500.000000","500.000000","0.100000","50"],["LOT-B","1500.000000","1500.000000","0.100000","150"]]);
      const receiptMovements = await manager.query(`SELECT count(*)::int AS count,sum(quantity_base)::text AS quantity,sum(total_cost_toman)::text AS total FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2 AND type='PURCHASE_RECEIPT' AND batch_id IS NOT NULL`,[tenantId,batchReceipt.id]);
      assert.deepEqual(receiptMovements[0],{count:2,quantity:"2000.000000",total:"200"});

      const openOrder = await purchasing.createPurchaseOrder(tenantId,actor.id,{supplierId:supplier.id,items:[{inventoryItemId:coffee.id,quantity:"5",unit:"kg",unitPriceToman:"1500000"}]});
      await purchasing.orderPurchaseOrder(tenantId,actor.id,openOrder.id);
      const openReceipt=await purchasing.createGoodsReceipt(tenantId,actor.id,{purchaseOrderId:openOrder.id,items:[{inventoryItemId:coffee.id,quantity:"1",unit:"kg",unitPriceToman:"1200000"},{inventoryItemId:coffee.id,quantity:"1",unit:"kg",unitPriceToman:"1400000"}]});
      await purchasing.postGoodsReceipt(tenantId,actor.id,openReceipt.id,false);
      const latestReceipt=await purchasing.createGoodsReceipt(tenantId,actor.id,{supplierId:supplier.id,items:[{inventoryItemId:coffee.id,quantity:"1",unit:"kg",unitPriceToman:"1500000"}]});
      await purchasing.postGoodsReceipt(tenantId,actor.id,latestReceipt.id,false);
      const competitor=await purchasing.createSupplier(tenantId,{name:"Second roaster"});
      const competitorReceipt=await purchasing.createGoodsReceipt(tenantId,actor.id,{supplierId:competitor.id,items:[{inventoryItemId:coffee.id,quantity:"500",unit:"g",unitPriceToman:"1560"}]});
      await purchasing.postGoodsReceipt(tenantId,actor.id,competitorReceipt.id,false);
      await inventory.updateStockSettings(tenantId,coffee.id,{locationId:location.id,unit:"kg",minimumQuantity:"6",parQuantity:"25"});
      await smartPurchasing.saveSupplierItemPreference(tenantId,supplier.id,coffee.id,{isPreferred:true,purchaseUnit:"kg",minimumOrderQuantity:"4"});
      const comparison=await smartPurchasing.supplierPrices(tenantId,coffee.id,{page:1,limit:20});
      const primaryPrices=comparison.items.find((row:{supplierId:string})=>row.supplierId===supplier.id);
      const competitorPrices=comparison.items.find((row:{supplierId:string})=>row.supplierId===competitor.id);
      assert.equal(primaryPrices.latestNormalizedPriceTomanPerBaseUnit,"1500.000000");
      assert.equal(primaryPrices.previousNormalizedPriceTomanPerBaseUnit,"1300.000000");
      assert.equal(primaryPrices.priceChangePercent,"15.38");
      assert.equal(primaryPrices.preferred,true);
      assert.equal(competitorPrices.latestNormalizedPriceTomanPerBaseUnit,"1560.000000");
      const history=await smartPurchasing.supplierPriceHistory(tenantId,coffee.id,{supplierId:supplier.id,page:1,limit:20});
      assert.ok(history.items.some((row:{receiptNumber:string})=>row.receiptNumber===latestReceipt.number));
      const [movementCountBeforeAssistant]=await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`,[tenantId]);
      const replenishment=await smartPurchasing.replenishment(tenantId,{page:1,limit:20,itemId:coffee.id,locationId:location.id});
      const recommendation=replenishment.items[0];
      assert.equal(recommendation.onOrderQuantity,"3");
      assert.equal(recommendation.projectedQuantity,"23");
      assert.equal(recommendation.projectedParGap,"2");
      assert.equal(recommendation.replenishmentGap,"2");
      assert.equal(recommendation.suggestedPurchaseQuantity,"4");
      assert.equal(recommendation.suggestedPurchaseUnit,"kg");
      assert.equal(recommendation.estimatedPurchaseCostToman,"6000000");
      assert.ok(recommendation.dataWarnings.includes("SUPPLIER_MINIMUM_APPLIED"));
      const [movementCountAfterAssistant]=await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`,[tenantId]);
      assert.equal(movementCountAfterAssistant.count,movementCountBeforeAssistant.count,"recommendation reads do not post inventory movements");
      await assert.rejects(smartPurchasing.supplierPrices(tenantId,otherCoffee.id,{page:1,limit:10}),/Inventory item not found/);
      await assert.rejects(smartPurchasing.saveSupplierItemPreference(tenantId,competitor.id,coffee.id,{purchaseUnit:"box"}),BadRequestException);
      await assert.rejects(smartPurchasing.saveSupplierItemPreference(tenantId,competitor.id,coffee.id,{minimumOrderQuantity:"0"}),BadRequestException);

      const expiredItem=await inventory.createItem(tenantId,actor.id,{name:"Expired tea",dimension:InventoryDimension.Weight,baseUnit:"g",locationId:location.id,batchTrackingEnabled:true,expiryTrackingEnabled:true});
      const expiredReceipt=await purchasing.createGoodsReceipt(tenantId,actor.id,{supplierId:supplier.id,items:[{inventoryItemId:expiredItem.id,quantity:"1000",unit:"g",unitPriceToman:"1000",batches:[{quantity:"1000",expiryDate:"2020-01-01"}]}]});
      await purchasing.postGoodsReceipt(tenantId,actor.id,expiredReceipt.id,false);
      await inventory.updateStockSettings(tenantId,expiredItem.id,{locationId:location.id,unit:"g",parQuantity:"5000"});
      const expiredRecommendation=await smartPurchasing.replenishment(tenantId,{page:1,limit:20,itemId:expiredItem.id,locationId:location.id});
      assert.equal(expiredRecommendation.items[0].quantity,"1000");
      assert.equal(expiredRecommendation.items[0].expiredBatchQuantity,"1000");
      assert.equal(expiredRecommendation.items[0].replenishmentGap,"5000");
      assert.ok(expiredRecommendation.items[0].dataWarnings.includes("EXPIRED_STOCK_EXCLUDED"));

      const secondary = await inventory.createLocation(tenantId, { name: "Cold room" });
      const [firstItem, secondItem] = [coffee, milk].sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id));
      const failed = await purchasing.createGoodsReceipt(tenantId, actor.id, { supplierId: supplier.id, items: [
        { inventoryItemId: firstItem.id, quantity: "1", unit: firstItem === coffee ? "g" : "ml", unitPriceToman: "10" },
        { inventoryItemId: secondItem.id, quantity: "1", unit: secondItem === coffee ? "g" : "ml", unitPriceToman: "10", locationId: secondary.id },
      ] });
      await manager.query(`UPDATE inventory_locations SET is_active=false WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, secondary.id]);
      const [balanceBeforeFailure] = await manager.query(`SELECT quantity_base::text FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, firstItem.id, location.id]);
      await assert.rejects(purchasing.postGoodsReceipt(tenantId, actor.id, failed.id, false), ConflictException);
      const [balanceAfterFailure] = await manager.query(`SELECT quantity_base::text FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, firstItem.id, location.id]);
      assert.equal(balanceAfterFailure.quantity_base, balanceBeforeFailure.quantity_base);
      const [failedMovement] = await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_id=$2`, [tenantId, failed.id]);
      assert.equal(failedMovement.count, 0, "a failure after one line must roll back all receipt movements");
      const inactive = await purchasing.updateSupplier(tenantId, supplier.id, { isActive: false });
      assert.equal((inactive as { isActive: boolean }).isActive, false);
      await assert.rejects(purchasing.createPurchaseOrder(tenantId, actor.id, { supplierId: supplier.id, items: [{ inventoryItemId: coffee.id, quantity: "1", unit: "kg", unitPriceToman: "100" }] }), /Active supplier not found/);
      assert.equal((await purchasing.goodsReceipt(tenantId, direct.id)).supplierName, "Roaster", "supplier deactivation keeps historical receipt readable");
      const [movementCount] = await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='GOODS_RECEIPT'`, [tenantId]);
      assert.equal(movementCount.count, 12);
      throw rollback;
    }), (error) => error === rollback);
  } finally { await db.destroy(); }
});
