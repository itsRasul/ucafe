import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "./auth-principal";
import { PLATFORM_PERMISSIONS_METADATA } from "./authorization.decorators";
import { AuthorizationService } from "./authorization.service";
import { PlatformPermissionKey } from "./permission.constants";

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly authorization: AuthorizationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<PlatformPermissionKey[]>(PLATFORM_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) throw new ForbiddenException("Platform permission metadata is required");

    const request = context.switchToHttp().getRequest<AuthorizedRequest>();
    const principal = request[AUTH_PRINCIPAL];
    if (!principal) throw new UnauthorizedException();

    if (!(await this.authorization.hasPlatformPermissions(principal.userId, required))) {
      throw new ForbiddenException("Platform permission denied");
    }
    return true;
  }
}
