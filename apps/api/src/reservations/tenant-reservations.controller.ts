import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { ReservationListQueryDto, UpdateReservationSettingsDto, UpdateReservationStatusDto } from "./dto/reservation.dto";
import { ReservationsService } from "./reservations.service";

@Controller("tenant/reservations")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantReservationsController {
  constructor(private readonly reservations: ReservationsService) {}
  private tenant(req: TenantContextRequest) { return req[TENANT_CONTEXT]!.coffeeShopId; }
  @Get() @RequireTenantPermissions(TenantPermissions.ReservationsRead) list(@Req() req: TenantContextRequest, @Query() query: ReservationListQueryDto) { return this.reservations.list(this.tenant(req), query); }
  @Get("settings") @RequireTenantPermissions(TenantPermissions.ReservationsManage) settings(@Req() req: TenantContextRequest) { return this.reservations.getSettings(this.tenant(req)); }
  @Patch("settings") @RequireTenantPermissions(TenantPermissions.ReservationsManage) updateSettings(@Req() req: TenantContextRequest, @Body() input: UpdateReservationSettingsDto) { return this.reservations.updateSettings(this.tenant(req), input); }
  @Get(":id") @RequireTenantPermissions(TenantPermissions.ReservationsRead) detail(@Req() req: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.reservations.detail(this.tenant(req), id); }
  @Patch(":id/status") @RequireTenantPermissions(TenantPermissions.ReservationsManage) status(@Req() req: TenantContextRequest & AuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateReservationStatusDto) { return this.reservations.updateStatus(this.tenant(req), id, req[AUTH_PRINCIPAL]!.userId, input); }
}
