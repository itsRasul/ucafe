import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateTenantCrmSegmentDto, PreviewTenantCrmSegmentDto, TenantCrmSegmentListQueryDto,
  TenantCrmSegmentMembersQueryDto, UpdateTenantCrmSegmentDto } from "./dto/tenant-crm-segments.dto";
import { TenantCrmSegmentsService } from "./tenant-crm-segments.service";

@Controller("tenant/crm")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmSegmentsController {
  constructor(private readonly segments: TenantCrmSegmentsService, private readonly subscriptions: SubscriptionsService) {}

  @Get("segments/fields")
  async fields(@Req() request: AuthorizedRequest) {
    return this.segments.fields((await this.tenant(request)).coffeeShopId);
  }

  @Get("segments")
  async list(@Req() request: AuthorizedRequest, @Query() query: TenantCrmSegmentListQueryDto) {
    const tenant = await this.tenant(request);
    return this.segments.list(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Post("segments/preview")
  async preview(@Req() request: AuthorizedRequest, @Body() input: PreviewTenantCrmSegmentDto) {
    const tenant = await this.tenant(request);
    return this.segments.preview(tenant.coffeeShopId, tenant.timezone, input.criteria);
  }

  @Post("segments")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async create(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmSegmentDto) {
    const tenant = await this.tenant(request);
    return this.segments.create(tenant.coffeeShopId, tenant.timezone, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Get("smart-groups")
  async smartGroups(@Req() request: AuthorizedRequest) {
    await this.tenant(request);
    return this.segments.listSmartGroups();
  }

  @Get("smart-groups/:key/preview")
  async smartGroupPreview(@Req() request: AuthorizedRequest, @Param("key") key: string) {
    const tenant = await this.tenant(request);
    return this.segments.smartGroupPreview(tenant.coffeeShopId, tenant.timezone, key);
  }

  @Get("smart-groups/:key/clients")
  async smartGroupMembers(@Req() request: AuthorizedRequest, @Param("key") key: string, @Query() query: TenantCrmSegmentMembersQueryDto) {
    const tenant = await this.tenant(request);
    return this.segments.smartGroupMembers(tenant.coffeeShopId, tenant.timezone, key, query);
  }

  @Get("segments/:segmentId/preview")
  async segmentPreview(@Req() request: AuthorizedRequest, @Param("segmentId", ParseUUIDPipe) segmentId: string) {
    const tenant = await this.tenant(request);
    return this.segments.segmentPreview(tenant.coffeeShopId, tenant.timezone, segmentId);
  }

  @Get("segments/:segmentId/clients")
  async segmentMembers(@Req() request: AuthorizedRequest, @Param("segmentId", ParseUUIDPipe) segmentId: string,
    @Query() query: TenantCrmSegmentMembersQueryDto) {
    const tenant = await this.tenant(request);
    return this.segments.segmentMembers(tenant.coffeeShopId, tenant.timezone, segmentId, query);
  }

  @Get("segments/:segmentId")
  async get(@Req() request: AuthorizedRequest, @Param("segmentId", ParseUUIDPipe) segmentId: string) {
    const tenant = await this.tenant(request);
    return this.segments.get(tenant.coffeeShopId, tenant.timezone, segmentId);
  }

  @Patch("segments/:segmentId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async update(@Req() request: AuthorizedRequest, @Param("segmentId", ParseUUIDPipe) segmentId: string,
    @Body() input: UpdateTenantCrmSegmentDto) {
    const tenant = await this.tenant(request);
    return this.segments.update(tenant.coffeeShopId, tenant.timezone, segmentId, input);
  }

  private async tenant(request: AuthorizedRequest) {
    const tenant = request[TENANT_CONTEXT]!;
    await this.subscriptions.requireFeature(tenant.coffeeShopId, SubscriptionFeatures.TenantCrm);
    return tenant;
  }
}
