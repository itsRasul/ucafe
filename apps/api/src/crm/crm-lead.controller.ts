import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { ChangeCrmLeadStatusDto, ConvertCrmLeadDto, CreateCrmLeadDto, CrmLeadDuplicateQueryDto, CrmLeadListQueryDto, QualifyCrmLeadDto, UnqualifyCrmLeadDto, UpdateCrmLeadDto } from "./dto/crm-lead.dto";
import { CrmLeadService } from "./crm-lead.service";

@Controller("platform/crm/leads")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmLeadController {
  constructor(private readonly leads: CrmLeadService) {}

  @Get() @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  list(@Query() query: CrmLeadListQueryDto) { return this.leads.list(query); }

  @Get("assignees") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  assignees() { return this.leads.listAssignees(); }

  @Post("duplicate-candidates") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  duplicateCandidates(@Body() input: CrmLeadDuplicateQueryDto) { return this.leads.duplicateCandidates(input, input.excludeId); }

  @Post() @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  create(@Body() input: CreateCrmLeadDto, @Req() req: AuthorizedRequest) { return this.leads.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get(":leadId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  get(@Param("leadId", ParseUUIDPipe) id: string) { return this.leads.get(id); }

  @Patch(":leadId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  update(@Param("leadId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmLeadDto, @Req() req: AuthorizedRequest) { return this.leads.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/status") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  changeStatus(@Param("leadId", ParseUUIDPipe) id: string, @Body() input: ChangeCrmLeadStatusDto, @Req() req: AuthorizedRequest) { return this.leads.changeStatus(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/qualify") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  qualify(@Param("leadId", ParseUUIDPipe) id: string, @Body() input: QualifyCrmLeadDto, @Req() req: AuthorizedRequest) { return this.leads.qualify(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/unqualify") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  unqualify(@Param("leadId", ParseUUIDPipe) id: string, @Body() input: UnqualifyCrmLeadDto, @Req() req: AuthorizedRequest) { return this.leads.unqualify(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/convert") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  convert(@Param("leadId", ParseUUIDPipe) id: string, @Body() input: ConvertCrmLeadDto, @Req() req: AuthorizedRequest) { return this.leads.convert(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archive(@Param("leadId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.leads.archive(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":leadId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restore(@Param("leadId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.leads.restore(id, req[AUTH_PRINCIPAL]!.userId); }
}
