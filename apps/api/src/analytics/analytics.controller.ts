import { Controller, Get, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { AnalyticsQueryDto } from "./analytics.dto";
import { AnalyticsService } from "./analytics.service";

@Controller("tenant/analytics")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get("overview")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  overview(@Req() req: TenantContextRequest, @Query() query: AnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.overview(tenant.coffeeShopId, tenant.timezone, query);
  }
}
