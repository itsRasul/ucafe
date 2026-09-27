import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { CreateCrmWorkflowDto, CrmWorkflowExecutionListDto, UpdateCrmWorkflowDto } from "./dto/crm-workflow.dto";
import { CrmWorkflowService } from "./crm-workflow.service";

@Controller("platform/crm")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmWorkflowController {
  constructor(private readonly workflows: CrmWorkflowService) {}

  @Get("workflows") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  list() { return this.workflows.list(); }

  @Post("workflows") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  create(@Body() input: CreateCrmWorkflowDto, @Req() request: AuthorizedRequest) { return this.workflows.create(input, request[AUTH_PRINCIPAL]!.userId); }

  @Get("workflows/:workflowId/executions") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  executions(@Param("workflowId", ParseUUIDPipe) id: string, @Query() query: CrmWorkflowExecutionListDto) { return this.workflows.executions(id, query); }

  @Post("workflows/:workflowId/archive") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  archive(@Param("workflowId", ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) { return this.workflows.archive(id, request[AUTH_PRINCIPAL]!.userId); }

  @Patch("workflows/:workflowId") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  update(@Param("workflowId", ParseUUIDPipe) id: string, @Body() input: UpdateCrmWorkflowDto, @Req() request: AuthorizedRequest) { return this.workflows.update(id, input, request[AUTH_PRINCIPAL]!.userId); }

  @Get("workflows/:workflowId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  get(@Param("workflowId", ParseUUIDPipe) id: string) { return this.workflows.get(id); }

  @Get("workflow-executions/:executionId") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  execution(@Param("executionId", ParseUUIDPipe) id: string) { return this.workflows.execution(id); }

  @Post("workflow-executions/:executionId/retry") @RequirePlatformPermissions(PlatformPermissions.CrmManage)
  retry(@Param("executionId", ParseUUIDPipe) id: string, @Req() request: AuthorizedRequest) { return this.workflows.retryExecution(id, request[AUTH_PRINCIPAL]!.userId); }
}
