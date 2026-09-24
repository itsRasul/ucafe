import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { DataSource } from "typeorm";
import { InventoryVarianceQueryDto } from "./variance.dto";
import { classifyInventoryVarianceMovement, InventoryVarianceService } from "./variance.service";

test("variance movement classification keeps reconciliation and ambiguous changes out of usage", () => {
  assert.equal(classifyInventoryVarianceMovement("PURCHASE_RECEIPT", "GOODS_RECEIPT"), "PHYSICAL_INBOUND");
  assert.equal(classifyInventoryVarianceMovement("SALE_REVERSAL", "ORDER_REVERSAL"), "THEORETICAL_SALE_USAGE");
  assert.equal(classifyInventoryVarianceMovement("WASTE", "WASTE_RECORD"), "KNOWN_WASTE");
  assert.equal(classifyInventoryVarianceMovement("MANUAL_ADJUSTMENT", "WASTE_REVERSAL"), "KNOWN_WASTE");
  assert.equal(classifyInventoryVarianceMovement("MANUAL_ADJUSTMENT", "MANUAL_ADJUSTMENT"), "AMBIGUOUS_ADJUSTMENT");
  assert.equal(classifyInventoryVarianceMovement("STOCK_COUNT_ADJUSTMENT", "STOCK_COUNT"), "RECONCILIATION");
});

test("variance request validates tenant-owned interval references and bounded pagination", () => {
  const valid = { locationId: randomUUID(), openingCountId: randomUUID(), closingCountId: randomUUID() };
  assert.equal(validateSync(plainToInstance(InventoryVarianceQueryDto, valid)).length, 0);
  assert.ok(validateSync(plainToInstance(InventoryVarianceQueryDto, { ...valid, limit: 101 })).length);
  assert.ok(validateSync(plainToInstance(InventoryVarianceQueryDto, { ...valid, sortBy: "sql" })).length);
});

test("variance report requires both Inventory and Analytics before querying", async () => {
  for (const blocked of ["inventory", "analytics"] as const) {
    let queried = false;
    const service = new InventoryVarianceService({ query: async () => { queried = true; return []; } } as never, {
      requireFeature: async (_tenant: string, feature: string) => {
        if (feature === blocked) throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature });
      },
    } as never);
    await assert.rejects(service.countOptions("tenant-a"), ForbiddenException);
    assert.equal(queried, false);
  }
});

test("count-to-count variance uses physical quantities, signed ledger usage, effective dates and tenant scope", {
  skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL,
}, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error("rollback inventory variance fixture");
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [actor] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actor?.id, "integration database needs one administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Variance Fixture',$2,'ACTIVE'),($3,'Variance Fixture Other',$4,'ACTIVE')`, [tenantId, `variance-${tenantId}`, otherTenantId, `variance-${otherTenantId}`]);
      const [location] = await manager.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default) VALUES($1,'Main',true) RETURNING id`, [tenantId]);
      const [otherLocation] = await manager.query(`INSERT INTO inventory_locations(coffee_shop_id,name,is_default) VALUES($1,'Main',true) RETURNING id`, [otherTenantId]);
      const [coffee] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Coffee','WEIGHT','g') RETURNING id`, [tenantId]);
      const [cups] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Cups','COUNT','piece') RETURNING id`, [tenantId]);
      const [zero] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Zero Stock','COUNT','piece') RETURNING id`, [tenantId]);
      const [missing] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Missing Count','VOLUME','ml') RETURNING id`, [tenantId]);
      const [otherItem] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Other Tenant Coffee','WEIGHT','g') RETURNING id`, [otherTenantId]);
      const [supplier] = await manager.query(`INSERT INTO inventory_suppliers(coffee_shop_id,name) VALUES($1,'Variance supplier') RETURNING id`, [tenantId]);
      const [receipt] = await manager.query(`INSERT INTO inventory_goods_receipts(coffee_shop_id,supplier_id,number,supplier_name_snapshot,created_by_user_id)
        VALUES($1,$2,$3,'Variance supplier',$4) RETURNING id`, [tenantId, supplier.id, `GR-${randomUUID().slice(0, 8)}`, actor.id]);
      const [receiptLine] = await manager.query(`INSERT INTO inventory_goods_receipt_lines(coffee_shop_id,goods_receipt_id,inventory_item_id,item_name_snapshot,location_id,quantity_display,unit,quantity_base,unit_price_toman,total_cost_toman)
        VALUES($1,$2,$3,'Coffee',$4,'5000','g','5000',10,50000) RETURNING id`, [tenantId, receipt.id, coffee.id, location.id]);
      const [client] = await manager.query(`INSERT INTO clients(coffee_shop_id,first_name,last_name,phone)
        VALUES($1,'Variance','Coverage',$2) RETURNING id`, [tenantId, `+9891${randomInt(10_000_000, 99_999_999)}`]);
      const [category] = await manager.query(`INSERT INTO menu_categories(coffee_shop_id,name) VALUES($1,'Variance Fixture') RETURNING id`, [tenantId]);
      const [menuItem] = await manager.query(`INSERT INTO menu_items(coffee_shop_id,category_id,name) VALUES($1,$2,'Tracked recipe') RETURNING id`, [tenantId, category.id]);
      const [recipe] = await manager.query(`INSERT INTO inventory_recipes(coffee_shop_id,menu_item_id) VALUES($1,$2) RETURNING id`, [tenantId, menuItem.id]);
      const [recipeVersion] = await manager.query(`INSERT INTO inventory_recipe_versions(coffee_shop_id,recipe_id,version_number,status,published_by_user_id,effective_from)
        VALUES($1,$2,1,'ACTIVE',$3,'2026-05-01T00:00:00Z') RETURNING id`, [tenantId, recipe.id, actor.id]);
      const [coffeeComponent] = await manager.query(`INSERT INTO inventory_recipe_components(coffee_shop_id,recipe_version_id,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base)
        VALUES($1,$2,$3,'Coffee','7800','g','7800') RETURNING id`, [tenantId, recipeVersion.id, coffee.id]);
      await manager.query(`UPDATE inventory_recipe_versions SET status='SUPERSEDED' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, recipeVersion.id]);
      const [reversedRecipeVersion] = await manager.query(`INSERT INTO inventory_recipe_versions(coffee_shop_id,recipe_id,version_number,status,published_by_user_id,effective_from)
        VALUES($1,$2,2,'ACTIVE',$3,'2026-06-03T00:00:00Z') RETURNING id`, [tenantId, recipe.id, actor.id]);
      const [reversedCoffeeComponent] = await manager.query(`INSERT INTO inventory_recipe_components(coffee_shop_id,recipe_version_id,inventory_item_id,inventory_item_name_snapshot,quantity_display,unit,quantity_base)
        VALUES($1,$2,$3,'Coffee','200','g','200') RETURNING id`, [tenantId, reversedRecipeVersion.id, coffee.id]);
      const [order] = await manager.query(`INSERT INTO orders(coffee_shop_id,client_id,status,payment_method,delivery_method,total_amount_toman,idempotency_key,status_changed_at,created_at)
        VALUES($1,$2,'PREPARING','OFFLINE','PICKUP',100,$3,'2026-06-05T10:00:00Z','2026-06-05T10:00:00Z') RETURNING id`, [tenantId, client.id, randomUUID()]);
      const [coffeeOrderItem] = await manager.query(`INSERT INTO order_items(coffee_shop_id,order_id,menu_item_id,item_name,unit_price_toman,quantity,line_total_toman)
        VALUES($1,$2,$3,'Tracked coffee',100,1,100) RETURNING id`, [tenantId, order.id, menuItem.id]);
      const [reversedCoffeeOrderItem] = await manager.query(`INSERT INTO order_items(coffee_shop_id,order_id,menu_item_id,item_name,unit_price_toman,quantity,line_total_toman)
        VALUES($1,$2,$3,'Reversed coffee',100,1,100) RETURNING id`, [tenantId, order.id, menuItem.id]);
      const [unlinkedOrderItem] = await manager.query(`INSERT INTO order_items(coffee_shop_id,order_id,item_name,unit_price_toman,quantity,line_total_toman)
        VALUES($1,$2,'Unlinked menu item',100,1,100) RETURNING id`, [tenantId, order.id]);

      const start = "2026-06-01T10:00:00Z", end = "2026-06-08T10:00:00Z";
      const addCount = async (countedAt: string, rows: Array<{ id: string; quantity: string }>, closing = false) => {
        const [count] = await manager.query(`INSERT INTO inventory_stock_counts(coffee_shop_id,location_id,created_by_user_id) VALUES($1,$2,$3) RETURNING id`, [tenantId, location.id, actor.id]);
        for (const row of rows) {
          const [line] = await manager.query(`INSERT INTO inventory_stock_count_lines(coffee_shop_id,count_id,item_id,expected_quantity,counted_quantity,counted_at)
            VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, [tenantId, count.id, row.id, row.quantity, row.quantity, countedAt]);
          if (closing && row.id === coffee.id) {
            const [adjustment] = await manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,created_at)
              VALUES($1,$2,$3,'STOCK_COUNT_ADJUSTMENT',-500,'STOCK_COUNT',$4,$5::timestamptz+interval '1 second') RETURNING id`, [tenantId, coffee.id, location.id, line.id, countedAt]);
            await manager.query(`UPDATE inventory_stock_count_lines SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, line.id, adjustment.id]);
          }
        }
        const completedAt = closing ? new Date(new Date(countedAt).getTime() + 2000).toISOString() : countedAt;
        await manager.query(`UPDATE inventory_stock_counts SET status='COMPLETED',completed_by_user_id=$3,completed_at=$4 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, count.id, actor.id, completedAt]);
        return count.id as string;
      };
      const openingCountId = await addCount(start, [{ id: coffee.id, quantity: "10000" }, { id: cups.id, quantity: "10" }, { id: zero.id, quantity: "0" }]);
      const closingCountId = await addCount(end, [{ id: coffee.id, quantity: "6000" }, { id: cups.id, quantity: "11" }, { id: zero.id, quantity: "0" }, { id: missing.id, quantity: "0" }], true);
      const insertMovement = (itemId: string, type: string, quantity: string, createdAt: string, extra: Record<string, unknown> = {}) => manager.query(
        `INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,source_line_id,order_item_id,recipe_version_id,recipe_component_id,reversal_of_movement_id,created_at)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
        [extra.tenantId ?? tenantId, itemId, extra.locationId ?? location.id, type, quantity, extra.sourceType ?? "IMPORT", extra.sourceId ?? randomUUID(), extra.sourceLineId ?? null,
          extra.orderItemId ?? null, extra.recipeVersionId ?? null, extra.recipeComponentId ?? null, extra.reversalOfMovementId ?? null, createdAt],
      );
      await insertMovement(coffee.id, "PURCHASE_RECEIPT", "999", start, { sourceType: "GOODS_RECEIPT" });
      const [purchaseMovement] = await insertMovement(coffee.id, "PURCHASE_RECEIPT", "5000", "2026-06-04T10:00:00Z", {
        sourceType: "GOODS_RECEIPT", sourceId: receipt.id, sourceLineId: receiptLine.id,
      });
      await manager.query(`UPDATE inventory_goods_receipt_lines SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, receiptLine.id, purchaseMovement.id]);
      await manager.query(`UPDATE inventory_goods_receipts SET status='POSTED',received_at='2026-06-04T10:00:00Z',posted_at='2026-06-09T11:00:00Z',posted_by_user_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, receipt.id, actor.id]);
      await insertMovement(coffee.id, "PURCHASE_RECEIPT", "777", "2026-06-09T10:00:00Z", { sourceType: "GOODS_RECEIPT" });
      await insertMovement(coffee.id, "SALE_CONSUMPTION", "-7800", "2026-06-02T10:00:00Z", {
        sourceType: "ORDER_CONSUMPTION", sourceId: order.id, orderItemId: coffeeOrderItem.id, recipeVersionId: recipeVersion.id, recipeComponentId: coffeeComponent.id,
      });
      const [reversedSale] = await insertMovement(coffee.id, "SALE_CONSUMPTION", "-200", "2026-06-03T10:00:00Z", {
        sourceType: "ORDER_CONSUMPTION", sourceId: order.id, orderItemId: reversedCoffeeOrderItem.id, recipeVersionId: reversedRecipeVersion.id, recipeComponentId: reversedCoffeeComponent.id,
      });
      await insertMovement(coffee.id, "SALE_REVERSAL", "200", end, {
        sourceType: "ORDER_REVERSAL", sourceId: order.id, orderItemId: reversedCoffeeOrderItem.id, recipeVersionId: reversedRecipeVersion.id,
        recipeComponentId: reversedCoffeeComponent.id, reversalOfMovementId: reversedSale.id,
      });
      await insertMovement(coffee.id, "SALE_CONSUMPTION", "-500", "2026-06-06T12:00:00Z", { sourceType: "IMPORT", sourceId: "unlinked-import", orderItemId: unlinkedOrderItem.id });
      await insertMovement(coffee.id, "SALE_CONSUMPTION", "-500", start, { sourceType: "IMPORT" });
      await insertMovement(coffee.id, "SALE_CONSUMPTION", "-500", "2026-06-09T10:00:00Z", { sourceType: "IMPORT" });
      await insertMovement(coffee.id, "STOCK_COUNT_ADJUSTMENT", "-300", "2026-06-05T10:00:00Z", { sourceType: "STOCK_COUNT" });
      await insertMovement(coffee.id, "MANUAL_ADJUSTMENT", "250", "2026-06-06T10:00:00Z", { sourceType: "MANUAL_ADJUSTMENT" });
      await insertMovement(coffee.id, "OPENING_BALANCE", "900", "2026-06-06T11:00:00Z", { sourceType: "OPENING_BALANCE" });
      await insertMovement(otherItem.id, "PURCHASE_RECEIPT", "999999", "2026-06-04T10:00:00Z", { tenantId: otherTenantId, sourceType: "GOODS_RECEIPT", locationId: otherLocation.id });

      const [waste] = await manager.query(`INSERT INTO inventory_waste_records(coffee_shop_id,location_id,wasted_at,reason,created_by_user_id)
        VALUES($1,$2,'2026-06-07T10:00:00Z','SPILLED',$3) RETURNING id`, [tenantId, location.id, actor.id]);
      const [wasteLine] = await manager.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,item_name_snapshot,quantity_display,unit,quantity_base)
        VALUES($1,$2,$3,'Coffee','0.4','kg','400') RETURNING id`, [tenantId, waste.id, coffee.id]);
      const [wasteMovement] = await manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,source_line_id,created_at)
        VALUES($1,$2,$3,'WASTE',-400,'WASTE_RECORD',$4,$5,'2026-06-09T11:00:00Z') RETURNING id`, [tenantId, coffee.id, location.id, waste.id, wasteLine.id]);
      await manager.query(`UPDATE inventory_waste_items SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, wasteLine.id, wasteMovement.id]);
      await manager.query(`UPDATE inventory_waste_records SET status='POSTED',posted_by_user_id=$3,posted_at='2026-06-09T11:00:01Z' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, waste.id, actor.id]);
      const [reversedWaste] = await manager.query(`INSERT INTO inventory_waste_records(coffee_shop_id,location_id,wasted_at,reason,created_by_user_id)
        VALUES($1,$2,'2026-06-06T10:00:00Z','SPILLED',$3) RETURNING id`, [tenantId, location.id, actor.id]);
      const [reversedWasteLine] = await manager.query(`INSERT INTO inventory_waste_items(coffee_shop_id,waste_record_id,item_id,item_name_snapshot,quantity_display,unit,quantity_base)
        VALUES($1,$2,$3,'Cups','1','piece','1') RETURNING id`, [tenantId, reversedWaste.id, cups.id]);
      const [reversedWasteMovement] = await manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,source_line_id,created_at)
        VALUES($1,$2,$3,'WASTE',-1,'WASTE_RECORD',$4,$5,'2026-06-06T10:00:00Z') RETURNING id`, [tenantId, cups.id, location.id, reversedWaste.id, reversedWasteLine.id]);
      await manager.query(`UPDATE inventory_waste_items SET movement_id=$3 WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, reversedWasteLine.id, reversedWasteMovement.id]);
      await manager.query(`UPDATE inventory_waste_records SET status='POSTED',posted_by_user_id=$3,posted_at='2026-06-06T10:00:01Z' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, reversedWaste.id, actor.id]);
      await manager.query(`INSERT INTO inventory_stock_movements(coffee_shop_id,item_id,location_id,type,quantity_base,source_type,source_id,source_line_id,created_at)
        VALUES($1,$2,$3,'MANUAL_ADJUSTMENT',1,'WASTE_REVERSAL',$4,$5,'2026-06-07T10:00:00Z')`, [tenantId, cups.id, location.id, reversedWaste.id, reversedWasteLine.id]);
      await manager.query(`UPDATE inventory_waste_records SET status='REVERSED',reversed_by_user_id=$3,reversed_at='2026-06-07T10:00:01Z' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, reversedWaste.id, actor.id]);

      const service = new InventoryVarianceService({ query: (sql: string, values?: unknown[]) => manager.query(sql, values) } as unknown as DataSource, { requireFeature: async () => undefined } as never);
      const report = await service.report(tenantId, { locationId: location.id, openingCountId, closingCountId, page: 1, limit: 100 });
      const coffeeRow = report.items.find((row: { itemId: string }) => row.itemId === coffee.id);
      const cupsRow = report.items.find((row: { itemId: string }) => row.itemId === cups.id);
      const missingRow = report.items.find((row: { itemId: string }) => row.itemId === missing.id);
      assert.equal(coffeeRow.actualDepletion, "9000.000000");
      assert.equal(coffeeRow.trustedInbound, "5000.000000");
      assert.equal(coffeeRow.theoreticalSaleUsage, "7800.000000");
      assert.equal(coffeeRow.knownWaste, "400.000000");
      assert.equal(coffeeRow.unexplainedVariance, "800.000000");
      assert.equal(coffeeRow.variancePercent, "10.26");
      assert.equal(coffeeRow.calculationStatus, "CALCULABLE_WITH_WARNINGS");
      assert.ok(coffeeRow.dataQualityFlags.includes("MANUAL_ADJUSTMENTS"));
      assert.ok(coffeeRow.dataQualityFlags.includes("COUNT_RECONCILIATION_DURING_PERIOD"));
      assert.ok(coffeeRow.dataQualityFlags.includes("OPENING_BALANCE_DURING_PERIOD"));
      assert.ok(coffeeRow.dataQualityFlags.includes("INVALID_MOVEMENT_SOURCE"));
      assert.ok(coffeeRow.dataQualityFlags.includes("ORDER_LINES_WITHOUT_INVENTORY_CONSUMPTION"));
      assert.equal(cupsRow.unexplainedVariance, "-1.000000");
      assert.equal(cupsRow.knownWaste, "0.000000");
      assert.equal(cupsRow.variancePercent, null);
      const zeroRow = report.items.find((row: { itemId: string }) => row.itemId === zero.id);
      assert.equal(zeroRow.actualDepletion, "0.000000");
      assert.equal(zeroRow.variancePercent, null);
      assert.equal(missingRow.actualDepletion, null);
      assert.equal(missingRow.calculationStatus, "NOT_CALCULABLE");
      assert.equal(report.summary.itemsAnalyzed, 4);
      assert.equal(report.summary.notCalculableItems, 1);
      assert.equal(report.summary.positiveVarianceItems, 1);
      assert.equal(report.summary.negativeVarianceItems, 1);
      assert.equal(report.coverage.orderItemsInCoverageWindow, 3);
      assert.equal(report.coverage.orderItemsWithInventoryConsumption, 2);
      assert.equal(report.coverage.orderCoveragePercent, "66.67");

      const detail = await service.item(tenantId, coffee.id, { locationId: location.id, openingCountId, closingCountId });
      assert.ok(detail.movements.some((movement: { type: string }) => movement.type === "SALE_REVERSAL"));
      assert.ok(detail.movements.some((movement: { type: string; sourceValid: boolean }) => movement.type === "SALE_CONSUMPTION" && movement.sourceValid));
      assert.ok(detail.movements.some((movement: { type: string; sourceValid: boolean }) => movement.type === "SALE_CONSUMPTION" && !movement.sourceValid));
      assert.equal(detail.closingCountAdjustment.quantityBase, "-500.000000");
      await assert.rejects(service.report(tenantId, { locationId: otherLocation.id, openingCountId, closingCountId }), /location/);
      await assert.rejects(service.report(tenantId, { locationId: location.id, openingCountId, closingCountId: randomUUID() }), /not found/i);
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally {
    await db.destroy();
  }
});
