import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { MenuCategory, MenuItem } from "../menu/entities";
import { CreatePromotionDto, PromotionTargetDto, UpdatePromotionDto } from "./dto/promotion.dto";
import { Promotion, PromotionRewardType, PromotionTarget } from "./entities";
import { promotionStatus } from "./promotion-pricing.util";

@Injectable()
export class PromotionsService {
  constructor(private readonly dataSource: DataSource) {}

  async list(coffeeShopId: string) {
    const promotions = await this.dataSource.getRepository(Promotion).find({ where: { coffeeShopId }, relations: { targets: true }, order: { updatedAt: "DESC" }, withDeleted: true });
    return this.projectMany(coffeeShopId, promotions);
  }

  async get(coffeeShopId: string, id: string) {
    const promotion = await this.dataSource.getRepository(Promotion).findOne({ where: { id, coffeeShopId }, relations: { targets: true }, withDeleted: true });
    if (!promotion) throw new NotFoundException("Promotion not found");
    return (await this.projectMany(coffeeShopId, [promotion]))[0];
  }

  async create(coffeeShopId: string, actorUserId: string, input: CreatePromotionDto) {
    this.validateFields(input.rewardType, input.rewardValue, input.startAt, input.endAt, input.name);
    const id = await this.dataSource.transaction(async (manager) => {
      await this.validateTargets(manager, coffeeShopId, input.targets);
      const promotion = await manager.save(Promotion, manager.create(Promotion, {
        coffeeShopId, name: input.name.trim(), description: input.description?.trim() || null,
        isActive: input.isActive, startAt: input.startAt ? new Date(input.startAt) : null, endAt: input.endAt ? new Date(input.endAt) : null,
        priority: input.priority, rewardType: input.rewardType, rewardValue: String(input.rewardValue), createdByUserId: actorUserId,
      }));
      await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
        coffeeShopId, promotionId: promotion.id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
      })));
      return promotion.id;
    });
    return this.get(coffeeShopId, id);
  }

  async update(coffeeShopId: string, id: string, input: UpdatePromotionDto) {
    await this.dataSource.transaction(async (manager) => {
      const promotion = await manager.findOne(Promotion, { where: { id, coffeeShopId }, relations: { targets: true } });
      if (!promotion) throw new NotFoundException("Promotion not found");
      const rewardType = input.rewardType ?? promotion.rewardType;
      const rewardValue = input.rewardValue ?? Number(promotion.rewardValue);
      const name = input.name ?? promotion.name;
      const startAt = input.startAt === undefined ? promotion.startAt?.toISOString() : input.startAt ?? undefined;
      const endAt = input.endAt === undefined ? promotion.endAt?.toISOString() : input.endAt ?? undefined;
      this.validateFields(rewardType, rewardValue, startAt, endAt, name);
      if (input.targets) await this.validateTargets(manager, coffeeShopId, input.targets);
      if (input.name !== undefined) promotion.name = name.trim();
      if (input.description !== undefined) promotion.description = input.description?.trim() || null;
      if (input.startAt !== undefined) promotion.startAt = input.startAt ? new Date(input.startAt) : null;
      if (input.endAt !== undefined) promotion.endAt = input.endAt ? new Date(input.endAt) : null;
      if (input.priority !== undefined) promotion.priority = input.priority;
      if (input.rewardType !== undefined) promotion.rewardType = rewardType;
      if (input.rewardValue !== undefined) promotion.rewardValue = String(input.rewardValue);
      await manager.save(promotion);
      if (input.targets) {
        await manager.delete(PromotionTarget, { coffeeShopId, promotionId: id });
        await manager.save(PromotionTarget, input.targets.map((target) => manager.create(PromotionTarget, {
          coffeeShopId, promotionId: id, menuItemId: target.menuItemId ?? null, categoryId: target.categoryId ?? null,
        })));
      }
    });
    return this.get(coffeeShopId, id);
  }

  async setActive(coffeeShopId: string, id: string, isActive: boolean) {
    const result = await this.dataSource.getRepository(Promotion).update({ id, coffeeShopId, deletedAt: IsNull() }, { isActive });
    if (!result.affected) throw new NotFoundException("Promotion not found");
    return this.get(coffeeShopId, id);
  }

  async archive(coffeeShopId: string, id: string) {
    const result = await this.dataSource.getRepository(Promotion).softDelete({ id, coffeeShopId, deletedAt: IsNull() });
    if (!result.affected) throw new NotFoundException("Promotion not found");
    return { archived: true };
  }

  private validateFields(type: PromotionRewardType, value: number, startAt?: string | null, endAt?: string | null, name?: string) {
    if (name !== undefined && !name.trim()) throw new BadRequestException("Promotion name is required");
    if (!Object.values(PromotionRewardType).includes(type)) throw new BadRequestException("Invalid promotion reward type");
    if (!Number.isSafeInteger(value) || (type === PromotionRewardType.Percentage && (value <= 0 || value > 100)) || (type === PromotionRewardType.FixedAmount && value <= 0) || (type === PromotionRewardType.FixedPrice && value < 0)) {
      throw new BadRequestException("Invalid promotion reward value");
    }
    if (startAt && Number.isNaN(Date.parse(startAt))) throw new BadRequestException("Invalid promotion start time");
    if (endAt && Number.isNaN(Date.parse(endAt))) throw new BadRequestException("Invalid promotion end time");
    if (startAt && endAt && new Date(endAt).getTime() <= new Date(startAt).getTime()) throw new BadRequestException("Promotion end time must be after its start time");
  }

  private async validateTargets(manager: import("typeorm").EntityManager, coffeeShopId: string, targets: PromotionTargetDto[]) {
    const itemIds: string[] = [];
    const categoryIds: string[] = [];
    for (const target of targets) {
      if (Boolean(target.menuItemId) === Boolean(target.categoryId)) throw new BadRequestException("Each promotion target must select one product or category");
      if (target.menuItemId) itemIds.push(target.menuItemId);
      if (target.categoryId) categoryIds.push(target.categoryId);
    }
    if (new Set(itemIds).size !== itemIds.length || new Set(categoryIds).size !== categoryIds.length) throw new BadRequestException("Promotion targets must be unique");
    const [items, categories] = await Promise.all([
      itemIds.length ? manager.find(MenuItem, { where: { id: In(itemIds), coffeeShopId, deletedAt: IsNull() } }) : [],
      categoryIds.length ? manager.find(MenuCategory, { where: { id: In(categoryIds), coffeeShopId, deletedAt: IsNull() } }) : [],
    ]);
    if (items.length !== itemIds.length || categories.length !== categoryIds.length) throw new BadRequestException("Promotion targets must belong to this cafe and be available");
  }

  private async projectMany(coffeeShopId: string, promotions: Promotion[]) {
    const targetRows = promotions.flatMap((promotion) => promotion.targets);
    const itemIds = [...new Set(targetRows.map((target) => target.menuItemId).filter((id): id is string => Boolean(id)))];
    const categoryIds = [...new Set(targetRows.map((target) => target.categoryId).filter((id): id is string => Boolean(id)))];
    const [items, categories] = await Promise.all([
      itemIds.length ? this.dataSource.getRepository(MenuItem).find({ where: { id: In(itemIds), coffeeShopId, deletedAt: IsNull() } }) : [],
      categoryIds.length ? this.dataSource.getRepository(MenuCategory).find({ where: { id: In(categoryIds), coffeeShopId, deletedAt: IsNull() } }) : [],
    ]);
    const itemById = new Map(items.map((item) => [item.id, item.name]));
    const categoryById = new Map(categories.map((category) => [category.id, category.name]));
    const now = new Date();
    return promotions.map((promotion) => ({
      id: promotion.id, name: promotion.name, description: promotion.description, isActive: promotion.isActive,
      status: promotionStatus(promotion, now), startAt: promotion.startAt, endAt: promotion.endAt, priority: promotion.priority,
      rewardType: promotion.rewardType, rewardValue: promotion.rewardValue,
      targets: promotion.targets.map((target) => target.menuItemId
        ? { type: "PRODUCT" as const, id: target.menuItemId, name: itemById.get(target.menuItemId) ?? null }
        : { type: "CATEGORY" as const, id: target.categoryId!, name: categoryById.get(target.categoryId!) ?? null }),
      createdAt: promotion.createdAt, updatedAt: promotion.updatedAt,
    }));
  }
}
