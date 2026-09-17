import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { ClientAccessTokenGuard } from "./client-access-token.guard";
import { ClientAuthService } from "./client-auth.service";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "./client-principal";
import { ClientsService } from "./clients.service";
import { RequestClientPhoneChangeDto, UpdateClientProfileDto, VerifyClientPhoneChangeDto } from "./dto/client-panel.dto";

@Controller("public/client-panel")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard, ClientAccessTokenGuard)
export class ClientPanelController {
  constructor(private readonly clients: ClientsService, private readonly authentication: ClientAuthService) {}

  @Get("overview")
  overview(@Req() request: TenantContextRequest & ClientAuthorizedRequest) {
    return this.clients.overview(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId);
  }

  @Patch("profile")
  updateProfile(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Body() input: UpdateClientProfileDto) {
    return this.clients.updateProfile(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, input);
  }

  @Post("profile/phone/otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  requestPhoneOtp(@Req() request: Request & TenantContextRequest, @Body() input: RequestClientPhoneChangeDto) {
    return this.authentication.requestOtp(request[TENANT_CONTEXT]!.coffeeShopId, input.phone, this.metadata(request));
  }

  @Post("profile/phone/otp/verify")
  verifyPhoneOtp(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Body() input: VerifyClientPhoneChangeDto) {
    const principal = request[CLIENT_PRINCIPAL]!;
    return this.authentication.verifyPhoneChange(request[TENANT_CONTEXT]!.coffeeShopId, principal.clientId, principal.sessionId, input.challengeId, input.otp);
  }

  private metadata(request: Request) {
    return { ip: request.ip, userAgent: request.get("user-agent") };
  }
}
