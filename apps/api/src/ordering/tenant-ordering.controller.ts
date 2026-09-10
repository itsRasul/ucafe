import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { OrdersQueryDto, UpdateOnlineOrderingSettingsDto, UpdateOrderStatusDto } from "./dto/ordering.dto";
import { OrderingService } from "./ordering.service";

@Controller("tenant")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantOrderingController {
  constructor(private readonly ordering: OrderingService) {}
  private tenant(req: TenantContextRequest) { return req[TENANT_CONTEXT]!.coffeeShopId; }

  @Get("orders")
  @RequireTenantPermissions(TenantPermissions.OrdersRead)
  list(@Req() req: TenantContextRequest, @Query() query: OrdersQueryDto) {
    return this.ordering.list(this.tenant(req), query);
  }

  @Get("orders/:id")
  @RequireTenantPermissions(TenantPermissions.OrdersRead)
  detail(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.ordering.detail(this.tenant(req), id);
  }

  @Patch("orders/:id/status")
  @RequireTenantPermissions(TenantPermissions.OrdersManage)
  status(@Req() req: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateOrderStatusDto) {
    return this.ordering.updateStatus(this.tenant(req), id, req[AUTH_PRINCIPAL]!.userId, input.status);
  }

  @Get("ordering/settings")
  @RequireTenantPermissions(TenantPermissions.OrdersRead)
  settings(@Req() req: TenantContextRequest) {
    return this.ordering.getSettings(this.tenant(req));
  }

  @Patch("ordering/settings")
  @RequireTenantPermissions(TenantPermissions.OrdersManage)
  updateSettings(@Req() req: TenantContextRequest, @Body() input: UpdateOnlineOrderingSettingsDto) {
    return this.ordering.updateSettings(this.tenant(req), input);
  }
}
