import { Controller, ForbiddenException, Get, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { AuthorizationService } from "../authorization/authorization.service";

@Controller("platform/admin/access")
@UseGuards(AccessTokenGuard)
export class PlatformAdminAccessController {
  constructor(private readonly authorization: AuthorizationService) {}
  @Get() async get(@Req() request: AuthorizedRequest) {
    const access = await this.authorization.getPlatformAccess(request[AUTH_PRINCIPAL]!.userId);
    if (!access) throw new ForbiddenException("Platform access denied");
    return access;
  }
}
