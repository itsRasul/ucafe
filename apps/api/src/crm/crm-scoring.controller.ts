import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateCrmScoringRuleDto, PreviewCrmScoringRuleDto, UpdateCrmScoringRuleDto } from "./dto/crm-scoring.dto";
import { CrmScoringService } from "./crm-scoring.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmScoringController {
  constructor(private readonly scoring: CrmScoringService) {}

  @Get("scoring/rules") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listRules() { return this.scoring.listRules(); }

  @Post("scoring/rules/preview") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  preview(@Body() input: PreviewCrmScoringRuleDto) { return this.scoring.preview(input.category, input.criteria); }

  @Post("scoring/rules") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createRule(@Body() input: CreateCrmScoringRuleDto, @Req() req: AuthorizedRequest) { return this.scoring.createRule(input, req[AUTH_PRINCIPAL]!.userId); }

  @Patch("scoring/rules/:id") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateRule(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCrmScoringRuleDto, @Req() req: AuthorizedRequest) { return this.scoring.updateRule(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("scoring/rules/:id/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveRule(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.scoring.archiveRule(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("leads/:leadId/score") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  score(@Param("leadId", ParseUUIDPipe) id: string) { return this.scoring.getScore(id); }

  @Post("leads/:leadId/recalculate-score") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  recalculateLead(@Param("leadId", ParseUUIDPipe) id: string) { return this.scoring.recalculateLead(id); }

  @Post("scoring/recalculate") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  recalculateActiveLeads() { return this.scoring.recalculateAllActive(); }
}
