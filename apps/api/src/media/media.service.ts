import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { DataSource, In, IsNull } from "typeorm";
import { CoffeeShop } from "../database/entities";
import { MenuItem } from "../menu/entities";
import { UpdateMediaDto, UploadMediaDto, UploadMenuItemImageDto } from "./dto/media.dto";
import { MediaAsset, MediaAssetKind } from "./entities";
import { createVariants, inspectImage, MediaVariant } from "./media-image.util";
import { MediaStorageService } from "./media-storage.service";

@Injectable()
export class MediaService {
  constructor(private readonly dataSource: DataSource, private readonly storage: MediaStorageService) {}

  projection(asset: MediaAsset) {
    const base = `/api/backend/public/media/${asset.id}`;
    return { id: asset.id, kind: asset.kind, width: asset.sourceWidth, height: asset.sourceHeight, focalX: Number(asset.focalX), focalY: Number(asset.focalY), sortOrder: asset.sortOrder, sources: { smallAvif: `${base}/small-avif`, largeAvif: `${base}/large-avif`, smallWebp: `${base}/small-webp`, largeWebp: `${base}/large-webp` } };
  }

  async list(coffeeShopId: string) {
    const assets = await this.dataSource.getRepository(MediaAsset).find({ where: { coffeeShopId, kind: In([MediaAssetKind.Logo, MediaAssetKind.Hero, MediaAssetKind.Gallery]), deletedAt: IsNull() }, order: { kind: "ASC", sortOrder: "ASC", createdAt: "ASC" } });
    return assets.map((asset) => this.projection(asset));
  }

  async listMenuItemImages(coffeeShopId: string) {
    const assets = await this.dataSource.getRepository(MediaAsset).find({ where: { coffeeShopId, kind: MediaAssetKind.MenuItem, deletedAt: IsNull() }, order: { createdAt: "ASC" } });
    return assets.map((asset) => ({ menuItemId: asset.menuItemId!, image: this.projection(asset) }));
  }

  async upload(coffeeShopId: string, input: UploadMediaDto, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Image file is required");
    if (!await this.dataSource.getRepository(CoffeeShop).existsBy({ id: coffeeShopId })) throw new NotFoundException("Coffee shop not found");
    const inspected = await inspectImage(file.buffer, input.kind);
    const id = randomUUID();
    const prefix = `tenants/${coffeeShopId}/${id}`;
    await this.storage.putVariants(prefix, await createVariants(file.buffer, input.kind));
    let replaced: MediaAsset[] = [];
    try {
      const asset = await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), 10)`, [coffeeShopId]);
        const current = await manager.find(MediaAsset, { where: { coffeeShopId, kind: input.kind, deletedAt: IsNull() }, order: { sortOrder: "ASC" } });
        if (input.kind === MediaAssetKind.Gallery && current.length >= 8) throw new BadRequestException("Gallery is limited to 8 images");
        if (input.kind !== MediaAssetKind.Gallery) {
          replaced = await manager.find(MediaAsset, { where: { coffeeShopId, kind: input.kind, deletedAt: IsNull() } });
          if (replaced.length) await manager.softRemove(replaced);
        }
        return manager.save(MediaAsset, manager.create(MediaAsset, { id, coffeeShopId, kind: input.kind, originalFilename: file.originalname.slice(0, 180), sourceMediaType: `image/${inspected.format}`, sourceSizeBytes: file.size, sourceWidth: inspected.width, sourceHeight: inspected.height, focalX: String(input.focalX), focalY: String(input.focalY), sortOrder: input.kind === MediaAssetKind.Gallery ? current.length : 0, storagePrefix: prefix }));
      });
      await Promise.allSettled(replaced.map((item) => this.storage.remove(item.storagePrefix)));
      return this.projection(asset);
    } catch (error) { await this.storage.remove(prefix).catch(() => undefined); throw error; }
  }

  async uploadMenuItemImage(coffeeShopId: string, menuItemId: string, input: UploadMenuItemImageDto, file?: Express.Multer.File) {
    if (!file) throw new BadRequestException("Image file is required");
    if (!await this.dataSource.getRepository(MenuItem).existsBy({ id: menuItemId, coffeeShopId, deletedAt: IsNull() })) throw new NotFoundException("Menu item not found");
    const inspected = await inspectImage(file.buffer, MediaAssetKind.MenuItem);
    const id = randomUUID();
    const prefix = `tenants/${coffeeShopId}/${id}`;
    await this.storage.putVariants(prefix, await createVariants(file.buffer, MediaAssetKind.MenuItem));
    let replaced: MediaAsset[] = [];
    try {
      const asset = await this.dataSource.transaction(async (manager) => {
        await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))`, [coffeeShopId, menuItemId]);
        if (!await manager.existsBy(MenuItem, { id: menuItemId, coffeeShopId, deletedAt: IsNull() })) throw new NotFoundException("Menu item not found");
        replaced = await manager.find(MediaAsset, { where: { coffeeShopId, menuItemId, kind: MediaAssetKind.MenuItem, deletedAt: IsNull() } });
        if (replaced.length) await manager.softRemove(replaced);
        return manager.save(MediaAsset, manager.create(MediaAsset, { id, coffeeShopId, menuItemId, kind: MediaAssetKind.MenuItem, originalFilename: file.originalname.slice(0, 180), sourceMediaType: `image/${inspected.format}`, sourceSizeBytes: file.size, sourceWidth: inspected.width, sourceHeight: inspected.height, focalX: String(input.focalX), focalY: String(input.focalY), sortOrder: 0, storagePrefix: prefix }));
      });
      await Promise.allSettled(replaced.map((item) => this.storage.remove(item.storagePrefix)));
      return this.projection(asset);
    } catch (error) { await this.storage.remove(prefix).catch(() => undefined); throw error; }
  }

  async updateMenuItemImage(coffeeShopId: string, menuItemId: string, input: UpdateMediaDto) {
    if (input.sortOrder !== undefined) throw new BadRequestException("Menu item images cannot be reordered");
    const repository = this.dataSource.getRepository(MediaAsset);
    const asset = await repository.findOne({ where: { coffeeShopId, menuItemId, kind: MediaAssetKind.MenuItem, deletedAt: IsNull() } });
    if (!asset) throw new NotFoundException("Menu item image not found");
    if (input.focalX !== undefined) asset.focalX = String(input.focalX);
    if (input.focalY !== undefined) asset.focalY = String(input.focalY);
    return this.projection(await repository.save(asset));
  }

  async removeMenuItemImage(coffeeShopId: string, menuItemId: string) {
    const repository = this.dataSource.getRepository(MediaAsset);
    const asset = await repository.findOne({ where: { coffeeShopId, menuItemId, kind: MediaAssetKind.MenuItem, deletedAt: IsNull() } });
    if (!asset) return false;
    await repository.softRemove(asset);
    await this.storage.remove(asset.storagePrefix).catch(() => undefined);
    return true;
  }

  async update(coffeeShopId: string, id: string, input: UpdateMediaDto) {
    const repository = this.dataSource.getRepository(MediaAsset);
    const asset = await repository.findOne({ where: { id, coffeeShopId, deletedAt: IsNull() } });
    if (!asset) throw new NotFoundException("Media asset not found");
    if (input.sortOrder !== undefined && asset.kind !== MediaAssetKind.Gallery) throw new BadRequestException("Only gallery images can be reordered");
    if (input.focalX !== undefined) asset.focalX = String(input.focalX);
    if (input.focalY !== undefined) asset.focalY = String(input.focalY);
    if (input.sortOrder !== undefined) asset.sortOrder = input.sortOrder;
    return this.projection(await repository.save(asset));
  }

  async remove(coffeeShopId: string, id: string) {
    const repository = this.dataSource.getRepository(MediaAsset);
    const asset = await repository.findOne({ where: { id, coffeeShopId, deletedAt: IsNull() } });
    if (!asset) throw new NotFoundException("Media asset not found");
    await repository.softRemove(asset);
    await this.storage.remove(asset.storagePrefix).catch(() => undefined);
  }

  async stream(coffeeShopId: string, id: string, variant: MediaVariant) {
    const asset = await this.dataSource.getRepository(MediaAsset).findOne({ where: { id, coffeeShopId, deletedAt: IsNull() } });
    if (!asset) throw new NotFoundException("Media asset not found");
    return this.storage.get(asset.storagePrefix, variant);
  }
}
