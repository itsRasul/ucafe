import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { SiteService } from "./site.service";

@Controller("public/site")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class PublicSiteController {
  constructor(private readonly site: SiteService) {}

  @Get()
  get(@Req() request: TenantContextRequest) {
    return this.site.getPublicSite(request[TENANT_CONTEXT]!.coffeeShopId);
  }
}
