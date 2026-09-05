import { CanActivate, ExecutionContext, Injectable, NotFoundException } from "@nestjs/common";
import { TENANT_CONTEXT, TenantContextRequest } from "./tenant-context";

@Injectable()
export class TenantContextGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantContextRequest>();
    if (!request[TENANT_CONTEXT]) throw new NotFoundException("Tenant was not found for this hostname");
    return true;
  }
}
