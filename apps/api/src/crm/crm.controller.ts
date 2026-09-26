import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { ContactDuplicateQueryDto, CreateContactDto, CreateOrganizationDto, CrmContactListQueryDto, CrmListQueryDto, LinkTenantDto, OrganizationDuplicateQueryDto, TenantLinkCandidatesQueryDto, UpdateContactDto, UpdateOrganizationDto } from "./dto/crm.dto";
import { CrmService } from "./crm.service";
import { CrmTimelineQueryDto } from "./dto/crm-timeline.dto";
import { CrmTimelineService } from "./crm-timeline.service";
import { CrmOrganization360Service } from "./crm-organization-360.service";
import { CrmCustomerContextService } from "./crm-customer-context.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly organization360: CrmOrganization360Service,
    private readonly timeline: CrmTimelineService,
    private readonly customerContext: CrmCustomerContextService,
  ) {}

  @Get("organizations") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listOrganizations(@Query() query: CrmListQueryDto) { return this.crm.listOrganizations(query); }

  @Post("organizations") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createOrganization(@Body() input: CreateOrganizationDto, @Req() req: AuthorizedRequest) { return this.crm.createOrganization(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("tenant-link-candidates") @RequirePlatformPermissions(PlatformPermissions.CrmRead, PlatformPermissions.TenantsRead)
  tenantLinkCandidates(@Query() query: TenantLinkCandidatesQueryDto) { return this.crm.listTenantLinkCandidates(query.organizationId); }

  @Get("organizations/duplicate-candidates") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  organizationDuplicates(@Query() input: OrganizationDuplicateQueryDto) { return this.crm.organizationDuplicateCandidates(input); }

  @Get("organizations/:organizationId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getOrganization(@Param("organizationId", ParseUUIDPipe) id: string) { return this.crm.getOrganization(id); }

  @Get("organizations/:organizationId/overview") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  organizationOverview(@Param("organizationId", ParseUUIDPipe) id: string) { return this.organization360.overview(id); }

  @Get("organizations/:organizationId/customer-context") @RequirePlatformPermissions(PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead)
  organizationCustomerContext(@Param("organizationId", ParseUUIDPipe) id: string) { return this.customerContext.get(id); }

  @Get("organizations/:organizationId/timeline") @RequirePlatformPermissions(PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead)
  organizationTimeline(@Param("organizationId", ParseUUIDPipe) id: string, @Query() query: CrmTimelineQueryDto) { return this.timeline.list(id, query); }

  @Patch("organizations/:organizationId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateOrganization(@Param("organizationId", ParseUUIDPipe) id: string, @Body() input: UpdateOrganizationDto, @Req() req: AuthorizedRequest) { return this.crm.updateOrganization(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("organizations/:organizationId/tenant-link") @RequirePlatformPermissions(PlatformPermissions.CrmManage, PlatformPermissions.TenantsRead)
  linkOrganizationTenant(@Param("organizationId", ParseUUIDPipe) id: string, @Body() input: LinkTenantDto, @Req() req: AuthorizedRequest) { return this.crm.linkOrganizationTenant(id, input.coffeeShopId, req[AUTH_PRINCIPAL]!.userId); }

  @Delete("organizations/:organizationId/tenant-link") @RequirePlatformPermissions(PlatformPermissions.CrmManage, PlatformPermissions.TenantsRead)
  unlinkOrganizationTenant(@Param("organizationId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.crm.unlinkOrganizationTenant(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("organizations/:organizationId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveOrganization(@Param("organizationId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.crm.archiveOrganization(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("organizations/:organizationId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restoreOrganization(@Param("organizationId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.crm.restoreOrganization(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("organizations/:organizationId/contacts") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listOrganizationContacts(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Query() query: CrmContactListQueryDto) { return this.crm.listContacts({ ...query, organizationId }); }

  @Post("organizations/:organizationId/contacts") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createContact(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Body() input: CreateContactDto, @Req() req: AuthorizedRequest) { return this.crm.createContact(organizationId, input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("organizations/:organizationId/contacts/duplicate-candidates") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  contactDuplicates(@Param("organizationId", ParseUUIDPipe) organizationId: string, @Query() input: ContactDuplicateQueryDto) { return this.crm.contactDuplicateCandidates(organizationId, input); }

  @Get("contacts") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listContacts(@Query() query: CrmContactListQueryDto) { return this.crm.listContacts(query); }

  @Get("contacts/:contactId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getContact(@Param("contactId", ParseUUIDPipe) id: string) { return this.crm.getContact(id); }

  @Patch("contacts/:contactId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateContact(@Param("contactId", ParseUUIDPipe) id: string, @Body() input: UpdateContactDto, @Req() req: AuthorizedRequest) { return this.crm.updateContact(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("contacts/:contactId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveContact(@Param("contactId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.crm.archiveContact(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("contacts/:contactId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restoreContact(@Param("contactId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.crm.restoreContact(id, req[AUTH_PRINCIPAL]!.userId); }
}
