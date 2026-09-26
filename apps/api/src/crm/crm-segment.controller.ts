import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateCrmSegmentDto, CrmSegmentListQueryDto, CrmSegmentPreviewDto, CrmSegmentRecordsQueryDto, UpdateCrmSegmentDto } from "./dto/crm-saved-view.dto";
import { CrmSegmentService } from "./crm-segment.service";

@Controller("platform/crm/segments")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmSegmentController {
  constructor(private readonly segments: CrmSegmentService) {}

  @Get() @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  list(@Query() query: CrmSegmentListQueryDto) { return this.segments.list(query.entityType); }

  @Post() @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  create(@Body() input: CreateCrmSegmentDto, @Req() req: AuthorizedRequest) { return this.segments.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("preview") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  previewDefinition(@Body() input: CrmSegmentPreviewDto) { return this.segments.previewDefinition(input.entityType, input.filterDefinition); }

  @Get(":id/preview") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  preview(@Param("id", ParseUUIDPipe) id: string) { return this.segments.preview(id); }

  @Get(":id/records") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  records(@Param("id", ParseUUIDPipe) id: string, @Query() query: CrmSegmentRecordsQueryDto) { return this.segments.records(id, query.page, query.pageSize); }

  @Get(":id") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  get(@Param("id", ParseUUIDPipe) id: string) { return this.segments.get(id); }

  @Patch(":id") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  update(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCrmSegmentDto, @Req() req: AuthorizedRequest) { return this.segments.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post(":id/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archive(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.segments.archive(id, req[AUTH_PRINCIPAL]!.userId); }
}
