import { Body, Controller, Get, Put, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { UpdateSiteDto } from "./dto/update-site.dto";
import { SiteService } from "./site.service";

@Controller("tenant/site")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SiteManage)
export class TenantSiteController {
  constructor(private readonly site: SiteService) {}

  @Get()
  get(@Req() request: TenantContextRequest) {
    return this.site.getPublicSite(request[TENANT_CONTEXT]!.coffeeShopId);
  }

  @Put()
  update(@Req() request: TenantContextRequest, @Body() input: UpdateSiteDto) {
    return this.site.update(request[TENANT_CONTEXT]!.coffeeShopId, input);
  }
}
