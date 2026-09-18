import { Controller, Get, Param, ParseUUIDPipe, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { PlatformOrdersService } from "./platform-orders.service";

@Controller("platform/consultation-requests")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.ConsultationRequestsRead)
export class PlatformOrdersController {
  constructor(private readonly orders: PlatformOrdersService) {}
  @Get() list() { return this.orders.list(); }
  @Get(":id") detail(@Param("id", ParseUUIDPipe) id: string) { return this.orders.detail(id); }
}
