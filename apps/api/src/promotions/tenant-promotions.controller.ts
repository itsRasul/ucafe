import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreatePromotionDto, UpdatePromotionDto } from "./dto/promotion.dto";
import { PromotionsService } from "./promotions.service";

type TenantAdminRequest = TenantContextRequest & AuthorizedRequest;

@Controller("tenant/promotions")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantPromotionsController {
  constructor(private readonly promotions: PromotionsService) {}
  private tenantId(request: TenantContextRequest) { return request[TENANT_CONTEXT]!.coffeeShopId; }

  @Get() @RequireTenantPermissions(TenantPermissions.MenuRead)
  list(@Req() request: TenantContextRequest) { return this.promotions.list(this.tenantId(request), request[TENANT_CONTEXT]!.timezone); }

  @Get(":id") @RequireTenantPermissions(TenantPermissions.MenuRead)
  get(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.promotions.get(this.tenantId(request), id, request[TENANT_CONTEXT]!.timezone); }

  @Post() @RequireTenantPermissions(TenantPermissions.MenuManage)
  create(@Req() request: TenantAdminRequest, @Body() input: CreatePromotionDto) { return this.promotions.create(this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input, request[TENANT_CONTEXT]!.timezone); }

  @Patch(":id") @RequireTenantPermissions(TenantPermissions.MenuManage)
  update(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdatePromotionDto) { return this.promotions.update(this.tenantId(request), id, input, request[TENANT_CONTEXT]!.timezone); }

  @Post(":id/activate") @RequireTenantPermissions(TenantPermissions.MenuManage)
  activate(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.promotions.setActive(this.tenantId(request), id, true, request[TENANT_CONTEXT]!.timezone); }

  @Post(":id/deactivate") @RequireTenantPermissions(TenantPermissions.MenuManage)
  deactivate(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.promotions.setActive(this.tenantId(request), id, false, request[TENANT_CONTEXT]!.timezone); }

  @Delete(":id") @HttpCode(200) @RequireTenantPermissions(TenantPermissions.MenuManage)
  archive(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.promotions.archive(this.tenantId(request), id); }
}
