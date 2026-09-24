import { Controller, Get, Param, ParseUUIDPipe, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { MenuProfitabilityQueryDto, RecipeCostQueryDto } from "./costing.dto";
import { RecipeCostingService } from "./costing.service";

@Controller("tenant/inventory")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class CostingController {
  constructor(private readonly costing: RecipeCostingService) {}
  private tenant(request: TenantContextRequest) { return request[TENANT_CONTEXT]!.coffeeShopId; }

  @Get("recipes/:id/cost") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  recipeCost(@Param("id", ParseUUIDPipe) id: string, @Query() query: RecipeCostQueryDto, @Req() request: TenantContextRequest) {
    return this.costing.recipeCost(this.tenant(request), id, query.versionId);
  }

  @Get("profitability/menu") @RequireTenantPermissions(TenantPermissions.InventoryRead)
  menuProfitability(@Query() query: MenuProfitabilityQueryDto, @Req() request: TenantContextRequest) {
    return this.costing.menuProfitability(this.tenant(request), query);
  }
}
