import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateCustomerSegmentDto, CustomerSearchDto, SegmentClientDto, UpdateCustomerSegmentDto } from "./dto/customer-segments.dto";
import { CustomerSegmentsService } from "./customer-segments.service";

type TenantAdminRequest = TenantContextRequest & AuthorizedRequest;

@Controller("tenant/customer-segments")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class CustomerSegmentsController {
  constructor(private readonly segments: CustomerSegmentsService) {}
  private tenantId(request: TenantContextRequest) { return request[TENANT_CONTEXT]!.coffeeShopId; }

  @Get() @RequireTenantPermissions(TenantPermissions.MenuRead)
  list(@Req() request: TenantContextRequest) { return this.segments.list(this.tenantId(request)); }

  @Get("clients") @RequireTenantPermissions(TenantPermissions.OrdersRead)
  customers(@Req() request: TenantContextRequest, @Query() query: CustomerSearchDto) { return this.segments.customers(this.tenantId(request), query); }

  @Get(":id/members") @RequireTenantPermissions(TenantPermissions.MenuRead)
  members(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Query() query: CustomerSearchDto) { return this.segments.members(this.tenantId(request), id, query); }

  @Post() @RequireTenantPermissions(TenantPermissions.MenuManage)
  create(@Req() request: TenantAdminRequest, @Body() input: CreateCustomerSegmentDto) { return this.segments.create(this.tenantId(request), input); }

  @Patch(":id") @RequireTenantPermissions(TenantPermissions.MenuManage)
  update(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCustomerSegmentDto) { return this.segments.update(this.tenantId(request), id, input); }

  @Delete(":id") @HttpCode(200) @RequireTenantPermissions(TenantPermissions.MenuManage)
  archive(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string) { return this.segments.archive(this.tenantId(request), id); }

  @Post(":id/members") @RequireTenantPermissions(TenantPermissions.MenuManage)
  addMember(@Req() request: TenantAdminRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: SegmentClientDto) { return this.segments.addMember(this.tenantId(request), id, input.clientId, request[AUTH_PRINCIPAL]!.userId); }

  @Delete(":id/members/:clientId") @HttpCode(200) @RequireTenantPermissions(TenantPermissions.MenuManage)
  removeMember(@Req() request: TenantContextRequest, @Param("id", ParseUUIDPipe) id: string, @Param("clientId", ParseUUIDPipe) clientId: string) { return this.segments.removeMember(this.tenantId(request), id, clientId); }
}
