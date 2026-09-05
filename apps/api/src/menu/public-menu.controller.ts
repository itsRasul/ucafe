import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { MenuService } from "./menu.service";

@Controller("public/menu")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class PublicMenuController {
  constructor(private readonly menu: MenuService) {}
  @Get() get(@Req() request: TenantContextRequest) { return this.menu.getMenu(request[TENANT_CONTEXT]!.coffeeShopId, true); }
}
