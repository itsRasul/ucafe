import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { ChangeCrmDealStageDto, CreateCrmDealDto, CrmDealListQueryDto, LoseCrmDealDto, UpdateCrmDealDto } from "./dto/crm-deal.dto";
import { CrmDealService } from "./crm-deal.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmDealController {
  constructor(private readonly deals: CrmDealService) {}

  @Get("pipeline") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  pipeline() { return this.deals.pipeline(); }

  @Get("deal-plans") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  planOptions() { return this.deals.planOptions(); }

  @Get("deals") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  list(@Query() query: CrmDealListQueryDto) { return this.deals.list(query); }

  @Post("deals") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  create(@Body() input: CreateCrmDealDto, @Req() req: AuthorizedRequest) { return this.deals.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("deals/:dealId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  get(@Param("dealId", ParseUUIDPipe) id: string) { return this.deals.get(id); }

  @Patch("deals/:dealId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  update(@Param("dealId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmDealDto, @Req() req: AuthorizedRequest) { return this.deals.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("deals/:dealId/stage") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  changeStage(@Param("dealId", ParseUUIDPipe) id: string, @Body() input: ChangeCrmDealStageDto, @Req() req: AuthorizedRequest) { return this.deals.changeStage(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("deals/:dealId/win") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  win(@Param("dealId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.deals.win(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("deals/:dealId/lose") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  lose(@Param("dealId", ParseUUIDPipe) id: string, @Body() input: LoseCrmDealDto, @Req() req: AuthorizedRequest) { return this.deals.lose(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("deals/:dealId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archive(@Param("dealId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.deals.archive(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("deals/:dealId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restore(@Param("dealId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.deals.restore(id, req[AUTH_PRINCIPAL]!.userId); }
}
