import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { CoffeeShopStatus } from "../database/entities";
import { TENANT_CONTEXT, TenantContextRequest } from "./tenant-context";

@Injectable()
export class PublicTenantAvailableGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<TenantContextRequest>();
    if (request[TENANT_CONTEXT]?.status === CoffeeShopStatus.Suspended) {
      throw new HttpException({ code: "TENANT_SUSPENDED", message: "این وب‌سایت در حال حاضر در دسترس نیست" }, HttpStatus.LOCKED);
    }
    return true;
  }
}
