import { Body, Controller, Get, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequireTenantPermissions } from "../authorization/authorization.decorators";
import { TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateCheckoutDto, PaymentCallbackDto } from "./dto/payment.dto";
import { PaymentsService } from "./payments.service";

@Controller("tenant/payments")
@UseGuards(AccessTokenGuard, TenantContextGuard, TenantPermissionGuard)
@RequireTenantPermissions(TenantPermissions.SubscriptionCheckout)
export class TenantPaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Post("checkout") checkout(@Req() request: TenantContextRequest, @Body() input: CreateCheckoutDto) { return this.service.checkout(request[TENANT_CONTEXT]!.coffeeShopId, input); }
}

@Controller("public/payments")
export class PublicPaymentsController {
  constructor(private readonly service: PaymentsService) {}
  @Get("callback") callback(@Query() input: PaymentCallbackDto) { return this.service.callback(input); }
}
