import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantPermissions } from "../authorization/permission.constants";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateTenantCrmCustomFieldDto, CreateTenantCrmTagDto, TenantCrmCustomFieldListQueryDto, TenantCrmReminderListQueryDto,
  TenantCrmTagListQueryDto, UpdateTenantCrmCustomFieldDto, UpdateTenantCrmReminderDto, UpdateTenantCrmTagDto } from "./dto/tenant-crm-phase3.dto";
import { TenantCrmService } from "./tenant-crm.service";

@Controller("tenant/crm")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmResourcesController {
  constructor(private readonly crm: TenantCrmService, private readonly subscriptions: SubscriptionsService) {}

  @Get("tags")
  async tags(@Req() request: AuthorizedRequest, @Query() query: TenantCrmTagListQueryDto) {
    return this.crm.listTags(await this.tenantId(request), query);
  }

  @Post("tags")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async createTag(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmTagDto) {
    return this.crm.createTag(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Patch("tags/:tagId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateTag(@Req() request: AuthorizedRequest, @Param("tagId", ParseUUIDPipe) tagId: string, @Body() input: UpdateTenantCrmTagDto) {
    return this.crm.updateTag(await this.tenantId(request), tagId, input);
  }

  @Delete("tags/:tagId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async archiveTag(@Req() request: AuthorizedRequest, @Param("tagId", ParseUUIDPipe) tagId: string) {
    return this.crm.archiveTag(await this.tenantId(request), tagId);
  }

  @Get("custom-fields")
  async customFields(@Req() request: AuthorizedRequest, @Query() query: TenantCrmCustomFieldListQueryDto) {
    return this.crm.listCustomFields(await this.tenantId(request), query);
  }

  @Get("users")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async users(@Req() request: AuthorizedRequest) {
    return this.crm.listActiveTenantUsers(await this.tenantId(request));
  }

  @Post("custom-fields")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async createCustomField(@Req() request: AuthorizedRequest, @Body() input: CreateTenantCrmCustomFieldDto) {
    return this.crm.createCustomField(await this.tenantId(request), request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Patch("custom-fields/:fieldId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateCustomField(@Req() request: AuthorizedRequest, @Param("fieldId", ParseUUIDPipe) fieldId: string, @Body() input: UpdateTenantCrmCustomFieldDto) {
    return this.crm.updateCustomField(await this.tenantId(request), fieldId, input);
  }

  @Get("reminders")
  async reminders(@Req() request: AuthorizedRequest, @Query() query: TenantCrmReminderListQueryDto) {
    const tenant = request[TENANT_CONTEXT]!;
    await this.subscriptions.requireFeature(tenant.coffeeShopId, SubscriptionFeatures.TenantCrm);
    return this.crm.listReminders(tenant.coffeeShopId, tenant.timezone, query);
  }

  @Patch("reminders/:reminderId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateReminder(@Req() request: AuthorizedRequest, @Param("reminderId", ParseUUIDPipe) reminderId: string, @Body() input: UpdateTenantCrmReminderDto) {
    return this.crm.updateReminder(await this.tenantId(request), reminderId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  private async tenantId(request: AuthorizedRequest) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return tenantId;
  }
}
