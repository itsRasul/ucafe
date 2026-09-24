import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { DataSource, EntityManager } from "typeorm";
import { InventoryService } from "./inventory.service";
import { InventoryDimension, InventoryStockAlertStatus, InventoryStockStatus, InventoryWasteReason } from "./entities";
import { inventoryStockStatus } from "./stock.util";
import { CreateWasteRecordDto, InventoryStockSettingsDto, StockAlertListQueryDto } from "./inventory.dto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";

test("stock status and thresholds use exact normalized comparisons", () => {
  assert.equal(inventoryStockStatus("-0.000001", null, null), InventoryStockStatus.Negative);
  assert.equal(inventoryStockStatus("0", null, null), InventoryStockStatus.OutOfStock);
  assert.equal(inventoryStockStatus("4.999999", "5", "15"), InventoryStockStatus.LowStock);
  assert.equal(inventoryStockStatus("5", "5", "15"), InventoryStockStatus.LowStock);
  assert.equal(inventoryStockStatus("14.999999", "5", "15"), InventoryStockStatus.BelowPar);
  assert.equal(inventoryStockStatus("15", "5", "15"), InventoryStockStatus.Ok);
  assert.equal(inventoryStockStatus("0.000001", null, null), InventoryStockStatus.Ok);
});

test("Phase 5 request boundaries reject invalid enums, quantities and pagination", () => {
  assert.ok(validateSync(plainToInstance(CreateWasteRecordDto, { locationId: randomUUID(), reason: "FREE_TEXT", items: [{ inventoryItemId: randomUUID(), quantity: "1", unit: "l" }] })).length);
  assert.ok(validateSync(plainToInstance(CreateWasteRecordDto, { locationId: randomUUID(), reason: InventoryWasteReason.Expired, items: [] })).length);
  assert.ok(validateSync(plainToInstance(InventoryStockSettingsDto, { locationId: randomUUID(), unit: "g", minimumQuantity: "-1" })).length);
  assert.ok(validateSync(plainToInstance(StockAlertListQueryDto, { status: "DISMISSED", page: "0" })).length);
});

test("Phase 5 APIs remain behind the shared Inventory entitlement", async () => {
  const service = new InventoryService({ query: async () => { throw new Error("database must not be queried"); } } as never, { requireFeature: async () => { throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature: "inventory" }); } } as never, {} as never);
  await assert.rejects(service.wasteRecords("tenant", {} as never), ForbiddenException);
  await assert.rejects(service.stockAlerts("tenant", {} as never), ForbiddenException);
  await assert.rejects(service.updateStockSettings("tenant", randomUUID(), {} as never), ForbiddenException);
});

test("waste, PAR alerts, tenant scope, cost snapshots, corrections and ordered-PO projection", { skip: !process.env.INVENTORY_INTEGRATION_DATABASE_URL }, async () => {
  const db = new DataSource({ type: "postgres", url: process.env.INVENTORY_INTEGRATION_DATABASE_URL });
  await db.initialize();
  const rollback = new Error(`rollback phase five ${randomUUID()}`);
  try {
    await assert.rejects(db.transaction(async (manager) => {
      const [{ id: actorId }] = await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actorId, "integration database needs an administrative user");
      const tenantId = randomUUID(), otherTenantId = randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Phase Five Test',$2,'ACTIVE'),($3,'Phase Five Other',$4,'ACTIVE')`, [tenantId, `phase-five-${tenantId}`, otherTenantId, `phase-five-${otherTenantId}`]);
      const adapter = { manager, query: (sql: string, params?: unknown[]) => manager.query(sql, params), transaction: <T>(work: (m: EntityManager) => Promise<T>) => work(manager) } as unknown as DataSource;
      const service = new InventoryService(adapter, { requireFeature: async () => undefined } as never, {} as never);
      const location = await service.createLocation(tenantId, { name: "Main", isDefault: true });
      const foreignLocation = await service.createLocation(otherTenantId, { name: "Other", isDefault: true });
      const milk = await service.createItem(tenantId, actorId, { name: "Milk", dimension: InventoryDimension.Volume, baseUnit: "ml", locationId: location.id, openingQuantity: "1000" } as never);
      const cake = await service.createItem(tenantId, actorId, { name: "Cake", dimension: InventoryDimension.Count, baseUnit: "piece", locationId: location.id, openingQuantity: "5" } as never);
      const [foreignItem] = await manager.query(`INSERT INTO inventory_items(coffee_shop_id,name,dimension,base_unit) VALUES($1,'Foreign Milk','VOLUME','ml') RETURNING id`, [otherTenantId]);
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=80 WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]);

      await service.updateStockSettings(tenantId, milk.id, { locationId: location.id, unit: "l", minimumQuantity: "0.8", parQuantity: "2" });
      let milkStock = (await service.stock(tenantId, { itemId: milk.id, locationId: location.id, page: 1, limit: 10 })).items[0];
      assert.equal(milkStock.stockStatus, InventoryStockStatus.BelowPar);
      assert.equal(milkStock.minimumQuantityBase, "800.000000");
      assert.equal((await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open))).total, 0);

      await manager.query(`SAVEPOINT waste_bad_input`);
      await assert.rejects(service.createWasteRecord(tenantId, actorId, { locationId: location.id, reason: InventoryWasteReason.Expired, items: [{ inventoryItemId: foreignItem.id, quantity: "1", unit: "l" }] } as CreateWasteRecordDto));
      await manager.query(`ROLLBACK TO SAVEPOINT waste_bad_input`);
      await manager.query(`SAVEPOINT waste_bad_quantity`);
      await assert.rejects(service.createWasteRecord(tenantId, actorId, { locationId: location.id, reason: InventoryWasteReason.Expired, items: [{ inventoryItemId: milk.id, quantity: "0", unit: "ml" }] } as CreateWasteRecordDto), (error: unknown) => error instanceof BadRequestException);
      await manager.query(`ROLLBACK TO SAVEPOINT waste_bad_quantity`);
      await manager.query(`SAVEPOINT waste_foreign_location`);
      await assert.rejects(service.createWasteRecord(tenantId, actorId, { locationId: foreignLocation.id, reason: InventoryWasteReason.Expired, items: [{ inventoryItemId: milk.id, quantity: "1", unit: "ml" }] } as CreateWasteRecordDto));
      await manager.query(`ROLLBACK TO SAVEPOINT waste_foreign_location`);

      const waste = await service.createWasteRecord(tenantId, actorId, { locationId: location.id, reason: InventoryWasteReason.Expired, note: "Morning check", items: [{ inventoryItemId: milk.id, quantity: "0.25", unit: "l" }, { inventoryItemId: cake.id, quantity: "3", unit: "piece" }] } as CreateWasteRecordDto);
      assert.equal(waste.status, "DRAFT");
      assert.equal(waste.items.length, 2);
      const failureItem = [milk.id, cake.id].sort()[1]!;
      await manager.query(`CREATE FUNCTION fail_phase_five_waste() RETURNS trigger AS $$ BEGIN IF NEW.source_type='WASTE_RECORD' AND NEW.source_id='${waste.id}' AND NEW.item_id='${failureItem}'::uuid THEN RAISE EXCEPTION 'injected waste movement failure'; END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
      await manager.query(`CREATE TRIGGER fail_phase_five_waste BEFORE INSERT ON inventory_stock_movements FOR EACH ROW EXECUTE FUNCTION fail_phase_five_waste()`);
      await manager.query(`SAVEPOINT waste_atomicity`);
      await assert.rejects(service.postWasteRecord(tenantId, actorId, waste.id), /injected waste movement failure/);
      await manager.query(`ROLLBACK TO SAVEPOINT waste_atomicity`);
      await manager.query(`DROP TRIGGER fail_phase_five_waste ON inventory_stock_movements`);
      await manager.query(`DROP FUNCTION fail_phase_five_waste()`);
      assert.equal((await service.wasteRecord(tenantId, waste.id)).status, "DRAFT");
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='WASTE_RECORD' AND source_id=$2`, [tenantId, waste.id]))[0].count, 0);

      const posted = await service.postWasteRecord(tenantId, actorId, waste.id);
      assert.equal(posted.status, "POSTED");
      assert.equal(posted.items.find((line: { itemId: string }) => line.itemId === milk.id).quantityBase, "250.000000");
      assert.equal(posted.items.find((line: { itemId: string }) => line.itemId === milk.id).totalCostToman, "20000");
      assert.equal(posted.items.find((line: { itemId: string }) => line.itemId === cake.id).totalCostToman, null);
      assert.equal(posted.estimatedCostToman, "20000");
      await service.postWasteRecord(tenantId, actorId, waste.id);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='WASTE_RECORD' AND source_id=$2`, [tenantId, waste.id]))[0].count, 2);
      milkStock = (await service.stock(tenantId, { itemId: milk.id, locationId: location.id, page: 1, limit: 10 })).items[0];
      assert.equal(milkStock.quantityBase, "750.000000");
      assert.equal(milkStock.stockStatus, InventoryStockStatus.LowStock);
      assert.equal((await manager.query(`SELECT average_unit_cost_toman::text AS value FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]))[0].value, "80.000000");
      const openAfterWaste = await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open));
      assert.equal(openAfterWaste.total, 1);
      await manager.query(`SAVEPOINT posted_waste_edit`);
      await assert.rejects(service.updateWasteRecord(tenantId, waste.id, { note: "rewrite" } as never), (error: unknown) => error instanceof ConflictException);
      await manager.query(`ROLLBACK TO SAVEPOINT posted_waste_edit`);
      await manager.query(`UPDATE inventory_stock_balances SET average_unit_cost_toman=90 WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]);
      assert.equal((await service.wasteRecord(tenantId, waste.id)).estimatedCostToman, "20000");
      const reversed = await service.reverseWasteRecord(tenantId, actorId, waste.id);
      assert.equal(reversed.status, "REVERSED");
      await service.reverseWasteRecord(tenantId, actorId, waste.id);
      assert.equal((await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1 AND source_type='WASTE_REVERSAL' AND source_id=$2`, [tenantId, waste.id]))[0].count, 2);
      milkStock = (await service.stock(tenantId, { itemId: milk.id, locationId: location.id, page: 1, limit: 10 })).items[0];
      assert.equal(milkStock.quantityBase, "1000.000000");
      assert.equal(milkStock.stockStatus, InventoryStockStatus.BelowPar);
      assert.equal((await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open))).total, 0);
      assert.equal((await manager.query(`SELECT average_unit_cost_toman::text AS value FROM inventory_stock_balances WHERE coffee_shop_id=$1 AND item_id=$2 AND location_id=$3`, [tenantId, milk.id, location.id]))[0].value, "90.000000");

      await service.updateStockSettings(tenantId, milk.id, { locationId: location.id, unit: "l", minimumQuantity: "1.1", parQuantity: "2" });
      assert.equal((await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open))).total, 1);
      await service.updateStockSettings(tenantId, milk.id, { locationId: location.id, unit: "l", minimumQuantity: "0.5", parQuantity: "2" });
      assert.equal((await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open))).total, 0);
      await manager.query(`SAVEPOINT invalid_stock_threshold`);
      await assert.rejects(service.updateStockSettings(tenantId, milk.id, { locationId: location.id, unit: "l", minimumQuantity: "1.5", parQuantity: "1" } as InventoryStockSettingsDto), (error: unknown) => error instanceof BadRequestException);
      await manager.query(`ROLLBACK TO SAVEPOINT invalid_stock_threshold`);

      for (const [quantity, key] of [["-501", "below"], ["-100", "lower"], ["1000", "recover"], ["-1000", "again"]] as [string, string][]) {
        await service.adjust(tenantId, actorId, { itemId: milk.id, locationId: location.id, quantity, reason: key, idempotencyKey: `phase-five:${key}:${randomUUID()}` });
      }
      assert.equal((await service.stockAlerts(tenantId, alertQuery(InventoryStockAlertStatus.Open))).total, 1);
      assert.equal((await service.stockAlerts(tenantId, alertQuery("ALL"))).total, 4);

      const [supplier] = await manager.query(`INSERT INTO inventory_suppliers(coffee_shop_id,name) VALUES($1,'Phase Five Supplier') RETURNING id`, [tenantId]);
      async function po(status: string, quantity: string, receiptQuantity?: string) {
        const number = `PO-${randomUUID().slice(0, 8)}`;
        const [order] = await manager.query(`INSERT INTO inventory_purchase_orders(coffee_shop_id,supplier_id,number,supplier_name_snapshot,status,order_date,created_by_user_id) VALUES($1,$2,$3,'Phase Five Supplier','DRAFT',CURRENT_DATE,$4) RETURNING id`, [tenantId, supplier.id, number, actorId]);
        const [line] = await manager.query(`INSERT INTO inventory_purchase_order_items(coffee_shop_id,purchase_order_id,inventory_item_id,location_id,item_name_snapshot,quantity_display,unit,quantity_base,unit_price_toman) VALUES($1,$2,$3,$4,'Milk',$5,'ml',$5,0) RETURNING id`, [tenantId, order.id, milk.id, location.id, quantity]);
        if (status !== "DRAFT") await manager.query(`UPDATE inventory_purchase_orders SET status='ORDERED',ordered_by_user_id=$3,ordered_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, order.id, actorId]);
        if (receiptQuantity) {
          const [receipt] = await manager.query(`INSERT INTO inventory_goods_receipts(coffee_shop_id,supplier_id,purchase_order_id,number,supplier_name_snapshot,received_at,created_by_user_id) VALUES($1,$2,$3,$4,'Phase Five Supplier',NULL,$5) RETURNING id`, [tenantId, supplier.id, order.id, `GR-${randomUUID().slice(0, 8)}`, actorId]);
          await manager.query(`INSERT INTO inventory_goods_receipt_lines(coffee_shop_id,goods_receipt_id,purchase_order_item_id,inventory_item_id,item_name_snapshot,location_id,quantity_display,unit,quantity_base,unit_price_toman,total_cost_toman) VALUES($1,$2,$3,$4,'Milk',$5,$6,'ml',$6,0,0)`, [tenantId, receipt.id, line.id, milk.id, location.id, receiptQuantity]);
          await manager.query(`UPDATE inventory_goods_receipts SET status='POSTED',posted_by_user_id=$2,posted_at=clock_timestamp(),received_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$3`, [tenantId, actorId, receipt.id]);
        }
        if (status === "PARTIALLY_RECEIVED") await manager.query(`UPDATE inventory_purchase_orders SET status='PARTIALLY_RECEIVED' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, order.id]);
        if (status === "RECEIVED") await manager.query(`UPDATE inventory_purchase_orders SET status='RECEIVED' WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, order.id]);
        if (status === "CANCELED") await manager.query(`UPDATE inventory_purchase_orders SET status='CANCELED',canceled_by_user_id=$3,canceled_at=clock_timestamp() WHERE coffee_shop_id=$1 AND id=$2`, [tenantId, order.id, actorId]);
      }
      await po("DRAFT", "1000");
      await po("ORDERED", "500");
      await po("PARTIALLY_RECEIVED", "800", "300");
      await po("CANCELED", "1000");
      await po("RECEIVED", "1000");
      milkStock = (await service.stock(tenantId, { itemId: milk.id, locationId: location.id, page: 1, limit: 10 } )).items[0];
      assert.equal(milkStock.onOrderQuantityBase, "1000.000000");
      assert.equal(milkStock.projectedQuantityBase, "1399.000000");
      assert.equal(milkStock.parGapBase, "1601.000000");
      assert.equal(milkStock.projectedParGapBase, "601.000000");
      assert.equal((await service.wasteRecords(otherTenantId, { page: 1, limit: 10 } as never)).total, 0);
      assert.equal((await service.stockAlerts(otherTenantId, alertQuery("ALL"))).total, 0);
      await assert.rejects(service.wasteRecord(otherTenantId, waste.id));
      await assert.rejects(service.updateStockSettings(otherTenantId, milk.id, { locationId: location.id } as InventoryStockSettingsDto));
      await assert.rejects(service.createWasteRecord(tenantId, actorId, { locationId: location.id, reason: InventoryWasteReason.Other, items: [{ inventoryItemId: foreignItem.id, quantity: "1", unit: "ml" }] } as CreateWasteRecordDto));
      throw rollback;
    }), (error: unknown) => error === rollback);
  } finally { await db.destroy(); }
});

function alertQuery(status: string) {
  return Object.assign(new StockAlertListQueryDto(), { status });
}
