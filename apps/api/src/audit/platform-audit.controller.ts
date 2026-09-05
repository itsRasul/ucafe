import { Controller, Get, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { PlatformAuditService } from "./platform-audit.service";

@Controller("platform/audit")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
@RequirePlatformPermissions(PlatformPermissions.AuditRead)
export class PlatformAuditController {
  constructor(private readonly audit: PlatformAuditService) {}
  @Get() list() { return this.audit.list(); }
}
