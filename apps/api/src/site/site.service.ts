import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { Branch, CoffeeShop } from "../database/entities";
import { BranchOpeningHour, WebsiteSettings } from "./entities";
import { UpdateSiteDto } from "./dto/update-site.dto";
import { safeForeground } from "./theme.util";
import { MediaService } from "../media/media.service";

@Injectable()
export class SiteService {
  constructor(private readonly dataSource: DataSource, private readonly media: MediaService) {}

  async getPublicSite(coffeeShopId: string) {
    const coffeeShop = await this.dataSource.getRepository(CoffeeShop).findOneBy({ id: coffeeShopId });
    if (!coffeeShop) throw new NotFoundException("Coffee shop not found");
    const settings = await this.dataSource.getRepository(WebsiteSettings).findOneBy({ coffeeShopId });
    const branch = await this.dataSource.getRepository(Branch).findOneBy({ coffeeShopId, isPrimary: true });
    const openingHours = branch ? await this.dataSource.getRepository(BranchOpeningHour).find({ where: { branchId: branch.id }, order: { dayOfWeek: "ASC" } }) : [];
    const primaryColor = settings?.primaryColor ?? "#6F4E37";
    const secondaryColor = settings?.secondaryColor ?? "#F4EEE4";
    const accentColor = settings?.accentColor ?? "#A85F35";
    return {
      name: coffeeShop.name,
      branchName: branch?.name ?? "شعبه اصلی",
      content: {
        heroTitle: settings?.heroTitle ?? coffeeShop.name,
        heroSubtitle: settings?.heroSubtitle ?? null,
        aboutTitle: settings?.aboutTitle ?? null,
        aboutBody: settings?.aboutBody ?? null,
        announcementText: settings?.announcementText ?? null,
      },
      theme: {
        templateKey: settings?.templateKey ?? "warm-editorial",
        primaryColor,
        primaryForeground: safeForeground(primaryColor),
        secondaryColor,
        secondaryForeground: safeForeground(secondaryColor),
        accentColor,
        accentForeground: safeForeground(accentColor),
        headingFont: settings?.headingFont ?? "Estedad",
        bodyFont: settings?.bodyFont ?? "Vazirmatn",
        radiusPreset: settings?.radiusPreset ?? "SOFT",
      },
      contact: {
        phone: branch?.phone ?? null,
        address: branch?.address ?? null,
        latitude: branch?.latitude ?? null,
        longitude: branch?.longitude ?? null,
        instagramUrl: settings?.instagramUrl ?? null,
      },
      openingHours: openingHours.map((item) => ({ dayOfWeek: item.dayOfWeek, isClosed: item.isClosed, opensAt: item.opensAt?.slice(0, 5) ?? null, closesAt: item.closesAt?.slice(0, 5) ?? null })),
      media: await this.media.list(coffeeShopId),
    };
  }

  async update(coffeeShopId: string, input: UpdateSiteDto) {
    if (input.openingHours) {
      const days = input.openingHours.map((item) => item.dayOfWeek);
      if (new Set(days).size !== days.length) throw new BadRequestException("Opening hours contain duplicate days");
      for (const item of input.openingHours) {
        if (item.isClosed && (item.opensAt || item.closesAt)) throw new BadRequestException("Closed days cannot contain opening times");
        if (!item.isClosed && (!item.opensAt || !item.closesAt || item.closesAt <= item.opensAt)) throw new BadRequestException("Open days require a valid same-day time range");
      }
    }

    await this.dataSource.transaction(async (manager) => {
      if (!await manager.existsBy(CoffeeShop, { id: coffeeShopId })) throw new NotFoundException("Coffee shop not found");
      if (input.name !== undefined) await manager.update(CoffeeShop, { id: coffeeShopId }, { name: input.name.trim() });
      let settings = await manager.findOneBy(WebsiteSettings, { coffeeShopId });
      settings ??= manager.create(WebsiteSettings, { coffeeShopId });
      const settingKeys = ["heroTitle", "heroSubtitle", "aboutTitle", "aboutBody", "announcementText", "instagramUrl", "headingFont", "bodyFont", "radiusPreset"] as const;
      for (const key of settingKeys) if (input[key] !== undefined) (settings[key] as unknown) = input[key];
      for (const key of ["primaryColor", "secondaryColor", "accentColor"] as const) if (input[key]) settings[key] = input[key].toUpperCase();
      await manager.save(settings);

      const branch = await manager.findOneByOrFail(Branch, { coffeeShopId, isPrimary: true });
      if (input.branchName !== undefined) branch.name = input.branchName.trim();
      if (input.contactPhone !== undefined) branch.phone = input.contactPhone?.trim() || null;
      if (input.address !== undefined) branch.address = input.address?.trim() || null;
      if (input.latitude !== undefined) branch.latitude = input.latitude;
      if (input.longitude !== undefined) branch.longitude = input.longitude;
      await manager.save(branch);

      if (input.openingHours) {
        await manager.delete(BranchOpeningHour, { branchId: branch.id });
        await manager.save(BranchOpeningHour, input.openingHours.map((item) => manager.create(BranchOpeningHour, {
          branchId: branch.id,
          dayOfWeek: item.dayOfWeek,
          isClosed: item.isClosed,
          opensAt: item.isClosed ? null : item.opensAt!,
          closesAt: item.isClosed ? null : item.closesAt!,
        })));
      }
    });
    return this.getPublicSite(coffeeShopId);
  }
}
