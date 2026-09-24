import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { DataSource, EntityManager } from "typeorm";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { InventoryService } from "./inventory.service";
import { addQuantities, quantityToBase } from "./quantity.util";
import { InventoryDimension, InventoryMovementType } from "./entities";
import { CreateInventoryItemDto, InventoryListQueryDto, StockAdjustmentDto } from "./inventory.dto";

test("quantities convert exact weight and volume units without floating point", () => {
  assert.equal(quantityToBase("1.25",InventoryDimension.Weight,"kg","g"),"1250");
  assert.equal(quantityToBase("0.125",InventoryDimension.Volume,"l","ml"),"125");
  assert.equal(addQuantities("-0.35","8.45","-2"),"6.1");
});

test("quantity conversion rejects cross-dimension, custom-count and excess-precision conversions", () => {
  assert.throws(()=>quantityToBase("1",InventoryDimension.Weight,"l","g"));
  assert.throws(()=>quantityToBase("1",InventoryDimension.Count,"box","piece"));
  assert.throws(()=>quantityToBase("0.000001",InventoryDimension.Weight,"g","kg"));
});

test("item creation rejects a base unit from another measurement dimension before persistence",async()=>{
  const service=new InventoryService({} as never,{requireFeature:async()=>undefined} as never,{} as never);
  await assert.rejects(service.createItem("tenant","actor",{name:"Milk",dimension:InventoryDimension.Weight,baseUnit:"l"} as CreateInventoryItemDto),error=>error instanceof BadRequestException);
});

test("every inventory operation rejects an unavailable subscription before querying data", async () => {
  let queried=false;
  const service=new InventoryService({query:async()=>{queried=true;return[];}} as never,{requireFeature:async()=>{throw new ForbiddenException({code:"FEATURE_UNAVAILABLE",feature:"inventory"});}} as never,{} as never);
  await assert.rejects(service.overview("tenant-a"),(error:unknown)=>error instanceof ForbiddenException);
  assert.equal(queried,false);
});

test("stock mutation types remain auditable domain values",()=>{
  assert.equal(InventoryMovementType.OpeningBalance,"OPENING_BALANCE");
  assert.equal(InventoryMovementType.ManualAdjustment,"MANUAL_ADJUSTMENT");
  assert.equal(InventoryMovementType.StockCountAdjustment,"STOCK_COUNT_ADJUSTMENT");
});

test("inventory boundary rejects bad pagination and quantity input",()=>{
  for(const input of [{page:"0"},{page:"-10"},{page:"99999999999999999"},{limit:"999999999"},{limit:"abc"}]) {
    assert.ok(validateSync(plainToInstance(InventoryListQueryDto,input)).length);
  }
  assert.ok(validateSync(plainToInstance(StockAdjustmentDto,{itemId:randomUUID(),locationId:randomUUID(),quantity:"0.0000001",reason:"test",idempotencyKey:"test"})).length);
});

test("inventory posts are tenant-scoped, idempotent, and stock counts rebase later movements",{skip:!process.env.INVENTORY_INTEGRATION_DATABASE_URL},async()=>{
  const db=new DataSource({type:"postgres",url:process.env.INVENTORY_INTEGRATION_DATABASE_URL});await db.initialize();
  const rollback=new Error(`rollback inventory ${randomUUID()}`);
  try{
    await assert.rejects(db.transaction(async(manager)=>{
      const [{id:actorId}]=await manager.query(`SELECT id FROM users ORDER BY created_at LIMIT 1`);
      assert.ok(actorId,"integration database needs one administrative user");
      const tenantId=randomUUID(),otherTenantId=randomUUID();
      await manager.query(`INSERT INTO coffee_shops(id,name,slug,status) VALUES($1,'Inventory Test',$2,'ACTIVE'),($3,'Inventory Test Other',$4,'ACTIVE')`,[tenantId,`inventory-${tenantId}`,otherTenantId,`inventory-${otherTenantId}`]);
      const adapter={manager,query:(sql:string,params?:unknown[])=>manager.query(sql,params),transaction:<T>(work:(m:EntityManager)=>Promise<T>)=>work(manager)} as unknown as DataSource;
      const service=new InventoryService(adapter,{requireFeature:async()=>undefined} as never,{} as never);
      const rejectUnique=async(work:()=>Promise<unknown>)=>{await manager.query(`SAVEPOINT inventory_unique_test`);await assert.rejects(work,error=>error instanceof ConflictException);await manager.query(`ROLLBACK TO SAVEPOINT inventory_unique_test`);};
      const category=await service.createCategory(tenantId,{name:"Ingredients"});
      await rejectUnique(()=>service.createCategory(tenantId,{name:" ingredients "}));
      const location=await service.createLocation(tenantId,{name:"Main",isDefault:true});
      await rejectUnique(()=>service.createLocation(tenantId,{name:" main "}));
      const item=await service.createItem(tenantId,actorId,{name:"Coffee",sku:"COFFEE",dimension:InventoryDimension.Weight,baseUnit:"kg",categoryId:category.id,locationId:location.id,openingQuantity:"10"} as CreateInventoryItemDto);
      await rejectUnique(()=>service.createItem(tenantId,actorId,{name:"Coffee 2",sku:"COFFEE",dimension:InventoryDimension.Weight,baseUnit:"kg",locationId:location.id} as CreateInventoryItemDto));
      await assert.rejects(service.createItem(otherTenantId,actorId,{name:"Foreign",dimension:InventoryDimension.Weight,baseUnit:"kg",categoryId:category.id,locationId:location.id} as CreateInventoryItemDto));
      await assert.rejects(service.saveCountLines(tenantId,randomUUID(),{lines:[{itemId:item.id,countedQuantity:"1"},{itemId:item.id,countedQuantity:"2"}]}),error=>error instanceof BadRequestException);
      const adjust={itemId:item.id,locationId:location.id,quantity:"-1",reason:"Count test",idempotencyKey:`adjust:${randomUUID()}`};
      const count=await service.createCount(tenantId,actorId,{locationId:location.id});
      const countPage=await service.counts(tenantId,{page:1,limit:30});assert.equal(countPage.total,1);assert.equal(countPage.items[0].id,count.id);
      await service.saveCountLines(tenantId,count.id,{lines:[{itemId:item.id,countedQuantity:"8"}]});
      const first=await service.adjust(tenantId,actorId,adjust),replay=await service.adjust(tenantId,actorId,adjust);
      assert.equal(replay.duplicate,true);assert.equal(first.balance,"9.000000");
      const posted=await service.completeCount(tenantId,actorId,count.id);
      assert.equal(posted.status,"COMPLETED");assert.equal(posted.lines[0].varianceQuantity,"-2.000000");
      const stock=await service.stock(tenantId,{locationId:location.id,page:1,limit:50});
      assert.equal(stock.items[0].quantityBase,"7.000000");
      const inactive=await service.updateItem(tenantId,item.id,{isActive:false});assert.equal((inactive as Record<string,unknown>).isActive,false);
      await assert.rejects(service.adjust(tenantId,actorId,{...adjust,idempotencyKey:`adjust:${randomUUID()}`}),error=>error instanceof ConflictException);
      const history=await service.movements(tenantId,{itemId:item.id,page:1,limit:50});assert.equal(history.total,3);
      await assert.rejects(service.updateItem(otherTenantId,item.id,{name:"Leaked"}));
      await assert.rejects(service.updateCategory(otherTenantId,category.id,{name:"Leaked"}));
      await assert.rejects(service.updateLocation(otherTenantId,location.id,{name:"Leaked"}));
      const foreignStock=await service.stock(otherTenantId,{page:1,limit:50});assert.equal(foreignStock.total,0);
      const foreignHistory=await service.movements(otherTenantId,{page:1,limit:50});assert.equal(foreignHistory.total,0);
      const [{count:movementCount}]=await manager.query(`SELECT count(*)::int AS count FROM inventory_stock_movements WHERE coffee_shop_id=$1`,[tenantId]);
      assert.equal(movementCount,3);
      throw rollback;
    }),error=>error===rollback);
  }finally{await db.destroy();}
});
