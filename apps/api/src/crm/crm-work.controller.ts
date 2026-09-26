import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import {
  CreateCrmActivityDto, CreateCrmNoteDto, CreateCrmTaskDto, CrmActivityListQueryDto, CrmNoteListQueryDto, CrmTaskListQueryDto,
  UpdateCrmActivityDto, UpdateCrmNoteDto, UpdateCrmTaskDto,
} from "./dto/crm-work.dto";
import { CrmActivityService } from "./crm-activity.service";
import { CrmNoteService } from "./crm-note.service";
import { CrmTaskService } from "./crm-task.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmWorkController {
  constructor(private readonly activities: CrmActivityService, private readonly tasks: CrmTaskService, private readonly notes: CrmNoteService) {}

  @Get("activities") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listActivities(@Query() query: CrmActivityListQueryDto) { return this.activities.list(query); }

  @Post("activities") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createActivity(@Body() input: CreateCrmActivityDto, @Req() req: AuthorizedRequest) { return this.activities.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("activities/:activityId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getActivity(@Param("activityId", ParseUUIDPipe) id: string) { return this.activities.get(id); }

  @Patch("activities/:activityId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateActivity(@Param("activityId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmActivityDto, @Req() req: AuthorizedRequest) { return this.activities.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("activities/:activityId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveActivity(@Param("activityId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.activities.archive(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("activities/:activityId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restoreActivity(@Param("activityId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.activities.restore(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("tasks") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listTasks(@Query() query: CrmTaskListQueryDto, @Req() req: AuthorizedRequest) { return this.tasks.list(query, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createTask(@Body() input: CreateCrmTaskDto, @Req() req: AuthorizedRequest) { return this.tasks.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("tasks/:taskId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getTask(@Param("taskId", ParseUUIDPipe) id: string) { return this.tasks.get(id); }

  @Patch("tasks/:taskId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateTask(@Param("taskId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmTaskDto, @Req() req: AuthorizedRequest) { return this.tasks.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks/:taskId/complete") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  completeTask(@Param("taskId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.tasks.complete(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks/:taskId/cancel") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  cancelTask(@Param("taskId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.tasks.cancel(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks/:taskId/reopen") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  reopenTask(@Param("taskId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.tasks.reopen(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks/:taskId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveTask(@Param("taskId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.tasks.archive(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("tasks/:taskId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restoreTask(@Param("taskId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.tasks.restore(id, req[AUTH_PRINCIPAL]!.userId); }

  @Get("notes") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  listNotes(@Query() query: CrmNoteListQueryDto) { return this.notes.list(query); }

  @Post("notes") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  createNote(@Body() input: CreateCrmNoteDto, @Req() req: AuthorizedRequest) { return this.notes.create(input, req[AUTH_PRINCIPAL]!.userId); }

  @Get("notes/:noteId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  getNote(@Param("noteId", ParseUUIDPipe) id: string) { return this.notes.get(id); }

  @Patch("notes/:noteId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  updateNote(@Param("noteId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmNoteDto, @Req() req: AuthorizedRequest) { return this.notes.update(id, input, req[AUTH_PRINCIPAL]!.userId); }

  @Post("notes/:noteId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archiveNote(@Param("noteId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.notes.archive(id, req[AUTH_PRINCIPAL]!.userId); }

  @Post("notes/:noteId/restore") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  restoreNote(@Param("noteId", ParseUUIDPipe) id: string, @Req() req: AuthorizedRequest) { return this.notes.restore(id, req[AUTH_PRINCIPAL]!.userId); }
}
