import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import sharp from "sharp";
import { CoffeeShop } from "../database/entities";
import { MenuItem } from "../menu/entities";
import { MediaAsset, MediaAssetKind } from "./entities";
import { MediaService } from "./media.service";

function createHarness(options: { itemExists?: boolean; active?: MediaAsset[] } = {}) {
  const active = options.active ?? [];
  const calls = { itemScope: undefined as unknown, removed: [] as string[], softRemoved: [] as MediaAsset[], saved: undefined as MediaAsset | undefined, listWhere: undefined as unknown };
  const assetRepository = {
    find: async (query: { where: unknown }) => { calls.listWhere = query.where; return active; },
    findOne: async () => active[0] ?? null,
    save: async (asset: MediaAsset) => asset,
    softRemove: async (asset: MediaAsset) => { calls.softRemoved.push(asset); return asset; },
  };
  const itemRepository = { existsBy: async (where: unknown) => { calls.itemScope = where; return options.itemExists ?? true; } };
  const manager = {
    query: async () => undefined,
    existsBy: itemRepository.existsBy,
    find: async () => active,
    softRemove: async (items: MediaAsset[]) => { calls.softRemoved.push(...items); return items; },
    create: (_type: unknown, value: Partial<MediaAsset>) => Object.assign(new MediaAsset(), value),
    save: async (_type: unknown, asset: MediaAsset) => { calls.saved = asset; return asset; },
  };
  const dataSource = {
    getRepository: (entity: unknown) => entity === MediaAsset ? assetRepository : entity === MenuItem ? itemRepository : { existsBy: async () => true },
    transaction: async (work: (value: typeof manager) => Promise<MediaAsset>) => work(manager),
  };
  const storage = {
    putVariants: async () => undefined,
    remove: async (prefix: string) => { calls.removed.push(prefix); },
  };
  return { service: new MediaService(dataSource as never, storage as never), calls };
}

test("menu image upload enforces tenant-scoped item lookup and fails before storage", async () => {
  const { service, calls } = createHarness({ itemExists: false });
  await assert.rejects(
    () => service.uploadMenuItemImage("tenant-a", "item-b", { focalX: 0.5, focalY: 0.5 }, undefined),
    BadRequestException,
  );
  const file = { buffer: Buffer.from("not needed"), originalname: "cup.png", size: 10 } as Express.Multer.File;
  await assert.rejects(() => service.uploadMenuItemImage("tenant-a", "item-b", { focalX: 0.5, focalY: 0.5 }, file), NotFoundException);
  assert.deepEqual(calls.itemScope, { id: "item-b", coffeeShopId: "tenant-a", deletedAt: assertNotNullOperator(calls.itemScope) });
});

test("menu image replacement soft-deletes the prior active image and removes its objects", async () => {
  const previous = Object.assign(new MediaAsset(), { id: "old", kind: MediaAssetKind.MenuItem, storagePrefix: "tenants/tenant-a/old" });
  const { service, calls } = createHarness({ active: [previous] });
  const buffer = await sharp({ create: { width: 600, height: 600, channels: 3, background: "#2b1710" } }).jpeg().toBuffer();
  const result = await service.uploadMenuItemImage("tenant-a", "item-b", { focalX: 0.25, focalY: 0.75 }, { buffer, originalname: "espresso.jpg", size: buffer.length } as Express.Multer.File);
  assert.equal(calls.softRemoved[0], previous);
  assert.deepEqual(calls.removed, [previous.storagePrefix]);
  assert.equal(calls.saved?.coffeeShopId, "tenant-a");
  assert.equal(calls.saved?.menuItemId, "item-b");
  assert.equal(calls.saved?.kind, MediaAssetKind.MenuItem);
  assert.equal(result.focalX, 0.25);
  assert.equal(result.focalY, 0.75);
});

test("focal updates remain tenant and item scoped and reject menu reordering", async () => {
  const active = [Object.assign(new MediaAsset(), { id: "image", coffeeShopId: "tenant-a", menuItemId: "item-b", kind: MediaAssetKind.MenuItem, focalX: "0.5", focalY: "0.5" })];
  const { service } = createHarness({ active });
  await assert.rejects(() => service.updateMenuItemImage("tenant-a", "item-b", { sortOrder: 1 }), BadRequestException);
  const result = await service.updateMenuItemImage("tenant-a", "item-b", { focalX: 0.1, focalY: 0.9 });
  assert.equal(result.focalX, 0.1);
  assert.equal(result.focalY, 0.9);
});

test("public site media listing excludes menu-item assets", async () => {
  const { service, calls } = createHarness();
  await service.list("tenant-a");
  const kind = (calls.listWhere as { kind: { _value: MediaAssetKind[] } }).kind;
  assert.deepEqual(kind._value, [MediaAssetKind.Logo, MediaAssetKind.Hero, MediaAssetKind.Gallery]);
  assert.ok(!kind._value.includes(MediaAssetKind.MenuItem));
});

function assertNotNullOperator(value: unknown) {
  return (value as { deletedAt: unknown } | undefined)?.deletedAt;
}
