import { Controller, Get, Req, UseGuards } from "@nestjs/common";
import { CoffeeShopStatus } from "../database/entities";
import { TENANT_CONTEXT, TenantContextRequest } from "./tenant-context";
import { TenantContextGuard } from "./tenant-context.guard";

@Controller("public")
@UseGuards(TenantContextGuard)
export class PublicTenantController {
  @Get("context")
  getContext(@Req() request: TenantContextRequest) {
    const context = request[TENANT_CONTEXT]!;
    const available = context.status !== CoffeeShopStatus.Suspended;
    return {
      available,
      ...(available ? {} : {
        unavailable: {
          code: "TENANT_SUSPENDED",
          title: "این وب‌سایت در حال حاضر در دسترس نیست",
          message: "لطفاً کمی بعد دوباره مراجعه کنید.",
        },
      }),
      slug: context.slug,
      status: context.status,
      locale: context.locale,
      timezone: context.timezone,
      hostname: context.hostname,
      domainType: context.domainType,
    };
  }
}
