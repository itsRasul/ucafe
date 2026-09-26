import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateCrmSavedViewDto, CrmSavedViewListQueryDto, UpdateCrmSavedViewDto } from "./dto/crm-saved-view.dto";
import { CrmSavedViewService } from "./crm-saved-view.service";

@Controller("platform/crm/saved-views")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmSavedViewController {
  constructor(private readonly views: CrmSavedViewService) {}

  @Get() @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  list(@Query() query: CrmSavedViewListQueryDto, @Req() req: AuthorizedRequest) { return this.views.list(query.entityType, req[AUTH_PRINCIPAL]!.userId); }

  @Post() @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  create(@Body() input: CreateCrmSavedViewDto, @Req() req: AuthorizedRequest) { return this.views.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get(":id") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  get(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.views.get(id, req[AUTH_PRINCIPAL]!.userId); }

  @Patch(":id") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  update(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCrmSavedViewDto, @Req() req: AuthorizedRequest) { return this.views.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":id/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archive(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.views.archive(id, req[AUTH_PRINCIPAL]!.userId); }
}
