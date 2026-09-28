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
import { ClientDirectoryQueryDto } from "./dto/client-directory-query.dto";
import { ClientTimelineQueryDto } from "./dto/client-timeline-query.dto";
import { CreateTenantCrmNoteDto, CreateTenantCrmReminderDto, TenantCrmNoteListQueryDto, UpdateTenantCrmCustomFieldValuesDto,
  UpdateTenantCrmNoteDto, UpdateTenantCrmPreferencesDto } from "./dto/tenant-crm-phase3.dto";
import { TenantCrmService } from "./tenant-crm.service";

@Controller("tenant/crm/clients")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.TenantCrmRead)
export class TenantCrmController {
  constructor(private readonly crm: TenantCrmService, private readonly subscriptions: SubscriptionsService) {}

  @Get()
  async list(@Req() request: AuthorizedRequest, @Query() query: ClientDirectoryQueryDto) {
    const tenantId = await this.tenantId(request);
    return this.crm.list(tenantId, query);
  }

  @Get(":clientId")
  async detail(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    const tenantId = await this.tenantId(request);
    return this.crm.detail(tenantId, clientId);
  }

  @Get(":clientId/timeline")
  async timeline(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Query() query: ClientTimelineQueryDto) {
    const tenantId = await this.tenantId(request);
    return this.crm.timeline(tenantId, clientId, query);
  }

  @Get(":clientId/notes")
  async notes(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Query() query: TenantCrmNoteListQueryDto) {
    return this.crm.listNotes(await this.tenantId(request), clientId, query);
  }

  @Post(":clientId/notes")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async createNote(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: CreateTenantCrmNoteDto) {
    const tenantId = await this.tenantId(request);
    return this.crm.createNote(tenantId, clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Patch(":clientId/notes/:noteId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateNote(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string,
    @Param("noteId", ParseUUIDPipe) noteId: string, @Body() input: UpdateTenantCrmNoteDto) {
    const tenantId = await this.tenantId(request);
    return this.crm.updateNote(tenantId, clientId, noteId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Delete(":clientId/notes/:noteId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async archiveNote(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Param("noteId", ParseUUIDPipe) noteId: string) {
    const tenantId = await this.tenantId(request);
    return this.crm.archiveNote(tenantId, clientId, noteId, request[AUTH_PRINCIPAL]!.userId);
  }

  @Get(":clientId/preferences")
  async preferences(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    return this.crm.preferences(await this.tenantId(request), clientId);
  }

  @Patch(":clientId/preferences")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updatePreferences(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: UpdateTenantCrmPreferencesDto) {
    return this.crm.updatePreferences(await this.tenantId(request), clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Get(":clientId/tags")
  async clientTags(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    return this.crm.clientTags(await this.tenantId(request), clientId);
  }

  @Post(":clientId/tags/:tagId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async assignTag(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Param("tagId", ParseUUIDPipe) tagId: string) {
    return this.crm.assignTag(await this.tenantId(request), clientId, tagId, request[AUTH_PRINCIPAL]!.userId);
  }

  @Delete(":clientId/tags/:tagId")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async removeTag(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Param("tagId", ParseUUIDPipe) tagId: string) {
    return this.crm.removeTag(await this.tenantId(request), clientId, tagId);
  }

  @Get(":clientId/custom-fields")
  async clientCustomFields(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string) {
    return this.crm.clientCustomFields(await this.tenantId(request), clientId);
  }

  @Patch(":clientId/custom-fields")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async updateClientCustomFields(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: UpdateTenantCrmCustomFieldValuesDto) {
    return this.crm.updateClientCustomFields(await this.tenantId(request), clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  @Post(":clientId/reminders")
  @RequireTenantPermissions(TenantPermissions.TenantCrmRead, TenantPermissions.TenantCrmManage)
  async createReminder(@Req() request: AuthorizedRequest, @Param("clientId", ParseUUIDPipe) clientId: string, @Body() input: CreateTenantCrmReminderDto) {
    return this.crm.createReminder(await this.tenantId(request), clientId, request[AUTH_PRINCIPAL]!.userId, input);
  }

  private async tenantId(request: AuthorizedRequest) {
    const tenantId = request[TENANT_CONTEXT]!.coffeeShopId;
    await this.subscriptions.requireFeature(tenantId, SubscriptionFeatures.TenantCrm);
    return tenantId;
  }
}
