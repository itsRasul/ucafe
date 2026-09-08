import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Redirect, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions, RequireTenantPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions, TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateCheckoutDto, PaymentCallbackDto } from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

@Controller("tenant/payments")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
export class TenantPaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @RequireTenantPermissions(TenantPermissions.SubscriptionCheckout)
  @Post("checkout") checkout(@Req() request: TenantContextRequest, @Body() input: CreateCheckoutDto) { return this.service.checkout(request[TENANT_CONTEXT]!.coffeeShopId, input); }
  @RequireTenantPermissions(TenantPermissions.SubscriptionRead)
  @Get("invoices") invoices(@Req() request: TenantContextRequest) { return this.service.listInvoices(request[TENANT_CONTEXT]!.coffeeShopId); }
  @RequireTenantPermissions(TenantPermissions.SubscriptionRead)
  @Get("invoices/:intentId") invoice(@Req() request: TenantContextRequest, @Param("intentId", new ParseUUIDPipe()) intentId: string) { return this.service.getInvoice(request[TENANT_CONTEXT]!.coffeeShopId, intentId); }
}

@Controller("platform/payments")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class PlatformPaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @RequirePlatformPermissions(PlatformPermissions.SubscriptionsManage, PlatformPermissions.UsersRead)
  @Get("invoices") invoices() { return this.service.listPlatformInvoices(); }
  @RequirePlatformPermissions(PlatformPermissions.SubscriptionsManage, PlatformPermissions.UsersRead)
  @Get("invoices/:intentId") invoice(@Param("intentId", new ParseUUIDPipe()) intentId: string) { return this.service.getPlatformInvoice(intentId); }
}

@Controller("public/payments")
export class PublicPaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Get("callback")
  @Redirect(undefined, 302)
  async callback(@Query() input: PaymentCallbackDto) {
    const result = await this.service.callback(input);
    return { url: result.redirectUrl };
  }
}
