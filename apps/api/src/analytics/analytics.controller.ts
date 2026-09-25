import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { AnalyticsQueryDto, CustomerAnalyticsQueryDto, ProductAnalyticsQueryDto } from "./analytics.dto";
import { AnalyticsService } from "./analytics.service";
import { InventoryVarianceService } from "../inventory/variance.service";
import { InventoryVarianceIntervalDto, InventoryVarianceQueryDto } from "../inventory/variance.dto";

@Controller("tenant/analytics")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService, private readonly inventoryVariance: InventoryVarianceService) {}

  @Get("inventory/variance/counts")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead, TenantPermissions.InventoryRead)
  varianceCountOptions(@Req() req: TenantContextRequest) {
    return this.inventoryVariance.countOptions(req[TENANT_CONTEXT]!.coffeeShopId);
  }

  @Get("inventory/variance")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead, TenantPermissions.InventoryRead)
  inventoryVarianceReport(@Req() req: TenantContextRequest, @Query() query: InventoryVarianceQueryDto) {
    return this.inventoryVariance.report(req[TENANT_CONTEXT]!.coffeeShopId, query);
  }

  @Get("inventory/variance/items/:itemId")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead, TenantPermissions.InventoryRead)
  inventoryVarianceItem(@Req() req: TenantContextRequest, @Param("itemId", ParseUUIDPipe) itemId: string, @Query() query: InventoryVarianceIntervalDto) {
    return this.inventoryVariance.item(req[TENANT_CONTEXT]!.coffeeShopId, itemId, query);
  }

  @Get("overview")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  overview(@Req() req: TenantContextRequest, @Query() query: AnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.overview(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Get("time-distribution")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  timeDistribution(@Req() req: TenantContextRequest, @Query() query: AnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.timeDistribution(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Get("products")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  products(@Req() req: TenantContextRequest, @Query() query: ProductAnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.products(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Get("customers")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  customers(@Req() req: TenantContextRequest, @Query() query: CustomerAnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.customers(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Get("products/:productId")
  @RequireTenantPermissions(TenantPermissions.AnalyticsRead)
  product(@Req() req: TenantContextRequest, @Param("productId", ParseUUIDPipe) productId: string, @Query() query: AnalyticsQueryDto) {
    const tenant = req[TENANT_CONTEXT]!;
    return this.analytics.product(tenant.coffeeShopId, tenant.timezone, productId, query);
  }
}
