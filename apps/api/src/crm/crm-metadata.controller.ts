import { Body, Controller, Get, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmCustomFieldValuesDto, CrmEntityTypeQueryDto, CrmFilterFieldsQueryDto, CrmRecordTagsDto, CrmTagListQueryDto, CreateCrmCustomFieldDto, CreateCrmTagDto, UpdateCrmCustomFieldDto, UpdateCrmTagDto } from "./dto/crm-metadata.dto";
import { CrmCustomFieldEntityType } from "./entities/crm-custom-field.entity";
import { CrmFilterService } from "./crm-filter.service";
import { CrmMetadataService } from "./crm-metadata.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmMetadataController {
  constructor(private readonly metadata: CrmMetadataService, private readonly filters: CrmFilterService) {}

  @Get("custom-fields") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listFields(@Query() query: CrmEntityTypeQueryDto) { return this.metadata.listFields(query.entityType, query.includeInactive === "true"); }

  @Post("custom-fields") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createField(@Body() input: CreateCrmCustomFieldDto, @Req() req: AuthorizedRequest) { return this.metadata.createField(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("custom-fields/:id") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getField(@Param("id", ParseUUIDPipe) id: string) { return this.metadata.getField(id); }

  @Patch("custom-fields/:id") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateField(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCrmCustomFieldDto, @Req() req: AuthorizedRequest) { return this.metadata.updateField(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("custom-fields/:id/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveField(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.metadata.archiveField(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("records/:entityType/:recordId/custom-fields") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getRecordFields(@Param("entityType", new ParseEnumPipe(CrmCustomFieldEntityType)) entityType: CrmCustomFieldEntityType, @Param("recordId", ParseUUIDPipe) id: string) { return this.metadata.getRecordFields(entityType, id); }

  @Patch("records/:entityType/:recordId/custom-fields") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateRecordFields(@Param("entityType", new ParseEnumPipe(CrmCustomFieldEntityType)) entityType: CrmCustomFieldEntityType, @Param("recordId", ParseUUIDPipe) id: string, @Body() input: CrmCustomFieldValuesDto, @Req() req: AuthorizedRequest) { return this.metadata.updateRecordFields(entityType, id, input.values, req[AUTH_PRINCIPAL]!.userId); }

  @Get("tags") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listTags(@Query() query: CrmTagListQueryDto) { return this.metadata.listTags(query.includeArchived === "true"); }

  @Post("tags") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createTag(@Body() input: CreateCrmTagDto, @Req() req: AuthorizedRequest) { return this.metadata.createTag(input, req[AUTH_PRINCIPAL]!.userId); }

  @Patch("tags/:id") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateTag(@Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateCrmTagDto, @Req() req: AuthorizedRequest) { return this.metadata.updateTag(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tags/:id/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveTag(@Param("id", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.metadata.archiveTag(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("records/:entityType/:recordId/tags") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getRecordTags(@Param("entityType", new ParseEnumPipe(CrmCustomFieldEntityType)) entityType: CrmCustomFieldEntityType, @Param("recordId", ParseUUIDPipe) id: string) { return this.metadata.getRecordTags(entityType, id); }

  @Put("records/:entityType/:recordId/tags") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  setRecordTags(@Param("entityType", new ParseEnumPipe(CrmCustomFieldEntityType)) entityType: CrmCustomFieldEntityType, @Param("recordId", ParseUUIDPipe) id: string, @Body() input: CrmRecordTagsDto, @Req() req: AuthorizedRequest) { return this.metadata.setRecordTags(entityType, id, input.tagIds, req[AUTH_PRINCIPAL]!.userId); }

  @Get("filter-fields") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  fields(@Query() query: CrmFilterFieldsQueryDto) { return this.filters.fields(query.entityType); }
}
