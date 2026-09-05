import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, IsNull } from "typeorm";
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from "./dto/menu-category.dto";
import { CreateMenuItemDto, MenuItemVariantDto, UpdateMenuItemDto } from "./dto/menu-item.dto";
import { MenuCategory, MenuItem, MenuItemVariant } from "./entities";
import { validateMenuPricing } from "./menu-validation.util";
import { MediaService } from "../media/media.service";

@Injectable()
export class MenuService {
  constructor(private readonly dataSource: DataSource, private readonly media: MediaService) {}

  async getMenu(coffeeShopId: string, publicOnly: boolean) {
    const categories = await this.dataSource.getRepository(MenuCategory).find({
      where: { coffeeShopId, deletedAt: IsNull(), ...(publicOnly ? { isActive: true } : {}) },
      order: { sortOrder: "ASC", createdAt: "ASC" },
    });
    const items = await this.dataSource.getRepository(MenuItem).find({
      where: { coffeeShopId, deletedAt: IsNull() },
      relations: { variants: true },
      order: { sortOrder: "ASC", createdAt: "ASC", variants: { sortOrder: "ASC" } },
    });
    const images = new Map((await this.media.listMenuItemImages(coffeeShopId)).map((entry) => [entry.menuItemId, entry.image]));
    return categories.map((category) => ({
      id: category.id,
      name: category.name,
      description: category.description,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      items: items.filter((item) => item.categoryId === category.id).map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        basePriceToman: item.basePriceToman,
        isAvailable: item.isAvailable,
        isFeatured: item.isFeatured,
        sortOrder: item.sortOrder,
        image: images.get(item.id) ?? null,
        variants: item.variants.map((variant) => ({ id: variant.id, name: variant.name, priceToman: variant.priceToman, isDefault: variant.isDefault, isAvailable: variant.isAvailable, sortOrder: variant.sortOrder })),
      })),
    }));
  }

  async createCategory(coffeeShopId: string, input: CreateMenuCategoryDto) {
    const category = this.dataSource.getRepository(MenuCategory).create({
      coffeeShopId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    });
    return this.dataSource.getRepository(MenuCategory).save(category);
  }

  async updateCategory(coffeeShopId: string, categoryId: string, input: UpdateMenuCategoryDto) {
    const repository = this.dataSource.getRepository(MenuCategory);
    const category = await repository.findOneBy({ id: categoryId, coffeeShopId, deletedAt: IsNull() });
    if (!category) throw new NotFoundException("Menu category not found");
    if (input.name !== undefined) category.name = input.name.trim();
    if (input.description !== undefined) category.description = input.description?.trim() || null;
    if (input.sortOrder !== undefined) category.sortOrder = input.sortOrder;
    if (input.isActive !== undefined) category.isActive = input.isActive;
    return repository.save(category);
  }

  async deleteCategory(coffeeShopId: string, categoryId: string) {
    return this.dataSource.transaction(async (manager) => {
      const category = await manager.findOneBy(MenuCategory, { id: categoryId, coffeeShopId, deletedAt: IsNull() });
      if (!category) throw new NotFoundException("Menu category not found");
      if (await manager.existsBy(MenuItem, { coffeeShopId, categoryId, deletedAt: IsNull() })) throw new ConflictException("Move or delete category items first");
      await manager.softRemove(category);
      return { deleted: true };
    });
  }

  async createItem(coffeeShopId: string, input: CreateMenuItemDto) {
    this.validatePricing(input.basePriceToman, input.variants);
    return this.dataSource.transaction(async (manager) => {
      if (!await manager.existsBy(MenuCategory, { id: input.categoryId, coffeeShopId, deletedAt: IsNull() })) throw new NotFoundException("Menu category not found");
      const item = await manager.save(MenuItem, manager.create(MenuItem, {
        coffeeShopId, categoryId: input.categoryId, name: input.name.trim(), description: input.description?.trim() || null,
        basePriceToman: input.basePriceToman?.toString() ?? null, isAvailable: input.isAvailable, isFeatured: input.isFeatured, sortOrder: input.sortOrder,
      }));
      await this.replaceVariants(manager, coffeeShopId, item.id, input.variants);
      return manager.findOneOrFail(MenuItem, { where: { id: item.id }, relations: { variants: true } });
    });
  }

  async updateItem(coffeeShopId: string, itemId: string, input: UpdateMenuItemDto) {
    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOneBy(MenuItem, { id: itemId, coffeeShopId, deletedAt: IsNull() });
      if (!item) throw new NotFoundException("Menu item not found");
      if (input.categoryId && !await manager.existsBy(MenuCategory, { id: input.categoryId, coffeeShopId, deletedAt: IsNull() })) throw new NotFoundException("Menu category not found");
      const variants = input.variants ?? await manager.findBy(MenuItemVariant, { itemId, coffeeShopId });
      const normalizedVariants = variants.map((variant) => ({ name: variant.name, priceToman: Number(variant.priceToman), isDefault: variant.isDefault, isAvailable: variant.isAvailable, sortOrder: variant.sortOrder }));
      this.validatePricing(input.basePriceToman !== undefined ? input.basePriceToman : item.basePriceToman === null ? null : Number(item.basePriceToman), normalizedVariants);
      if (input.categoryId !== undefined) item.categoryId = input.categoryId;
      if (input.name !== undefined) item.name = input.name.trim();
      if (input.description !== undefined) item.description = input.description?.trim() || null;
      if (input.basePriceToman !== undefined) item.basePriceToman = input.basePriceToman?.toString() ?? null;
      if (input.isAvailable !== undefined) item.isAvailable = input.isAvailable;
      if (input.isFeatured !== undefined) item.isFeatured = input.isFeatured;
      if (input.sortOrder !== undefined) item.sortOrder = input.sortOrder;
      await manager.save(item);
      if (input.variants) await this.replaceVariants(manager, coffeeShopId, item.id, input.variants);
      return manager.findOneOrFail(MenuItem, { where: { id: item.id }, relations: { variants: true } });
    });
  }

  async deleteItem(coffeeShopId: string, itemId: string) {
    const result = await this.dataSource.getRepository(MenuItem).softDelete({ id: itemId, coffeeShopId, deletedAt: IsNull() });
    if (!result.affected) throw new NotFoundException("Menu item not found");
    await this.media.removeMenuItemImage(coffeeShopId, itemId);
    return { deleted: true };
  }

  private validatePricing(basePriceToman: number | null | undefined, variants: MenuItemVariantDto[]) {
    const error = validateMenuPricing(basePriceToman, variants);
    if (error) throw new BadRequestException(error);
  }

  private async replaceVariants(manager: EntityManager, coffeeShopId: string, itemId: string, variants: MenuItemVariantDto[]) {
    await manager.delete(MenuItemVariant, { coffeeShopId, itemId });
    if (!variants.length) return;
    await manager.save(MenuItemVariant, variants.map((variant) => manager.create(MenuItemVariant, {
      coffeeShopId, itemId, name: variant.name.trim(), priceToman: variant.priceToman.toString(), isDefault: variant.isDefault, isAvailable: variant.isAvailable, sortOrder: variant.sortOrder,
    })));
  }
}
