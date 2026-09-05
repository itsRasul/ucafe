import { Body, Controller, Get, Param, ParseUUIDPipe, Put, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { UpdateSiteDto } from "./dto/update-site.dto";
import { SiteService } from "./site.service";

@Controller("platform/tenants/:coffeeShopId/site")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.TenantsUpdate)
export class PlatformSiteController {
  constructor(private readonly site: SiteService) {}

  @Get()
  get(@Param("coffeeShopId", ParseUUIDPipe) coffeeShopId: string) {
    return this.site.getPublicSite(coffeeShopId);
  }

  @Put()
  update(@Param("coffeeShopId", ParseUUIDPipe) coffeeShopId: string, @Body() input: UpdateSiteDto) {
    return this.site.update(coffeeShopId, input);
  }
}
