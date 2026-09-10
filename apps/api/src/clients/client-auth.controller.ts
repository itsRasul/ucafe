import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "./client-principal";
import { ClientAccessTokenGuard } from "./client-access-token.guard";
import { ClientAuthenticationResult, ClientAuthService } from "./client-auth.service";
import { RequestClientOtpDto, VerifyClientOtpDto } from "./dto/client-auth.dto";
import { ClientsService } from "./clients.service";

const CLIENT_REFRESH_COOKIE = "ucafe_client_refresh";
const CLIENT_REFRESH_PATH = "/api/v1/public/client-auth";

@Controller("public/client-auth")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard)
export class ClientAuthController {
  constructor(private readonly authentication: ClientAuthService, private readonly clients: ClientsService, private readonly config: ConfigService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(@Body() input: RequestClientOtpDto, @Req() request: Request & TenantContextRequest) {
    return this.authentication.requestOtp(request[TENANT_CONTEXT]!.coffeeShopId, input.phone, this.metadata(request));
  }

  @Post("otp/verify")
  async verifyOtp(@Body() input: VerifyClientOtpDto, @Req() request: Request & TenantContextRequest, @Res({ passthrough: true }) response: Response) {
    return this.publicResult(await this.authentication.verifyOtp(request[TENANT_CONTEXT]!.coffeeShopId, input.challengeId, input.otp, this.metadata(request), input), response);
  }

  @Post("refresh")
  async refresh(@Req() request: Request & TenantContextRequest, @Res({ passthrough: true }) response: Response) {
    return this.publicResult(await this.authentication.refresh(request[TENANT_CONTEXT]!.coffeeShopId, (request.cookies?.[CLIENT_REFRESH_COOKIE] as string | undefined) ?? "", this.metadata(request)), response);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    await this.authentication.logout(request.cookies?.[CLIENT_REFRESH_COOKIE] as string | undefined);
    response.clearCookie(CLIENT_REFRESH_COOKIE, { path: CLIENT_REFRESH_PATH });
  }

  @Get("me")
  @UseGuards(ClientAccessTokenGuard)
  me(@Req() request: TenantContextRequest & ClientAuthorizedRequest) {
    return this.clients.me(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId);
  }

  private publicResult(result: ClientAuthenticationResult, response: Response) {
    response.cookie(CLIENT_REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
      path: CLIENT_REFRESH_PATH,
      expires: result.refreshTokenExpiresAt,
    });
    return { accessToken: result.accessToken, accessTokenExpiresInSeconds: result.accessTokenExpiresInSeconds, client: result.client };
  }

  private metadata(request: Request) {
    return { ip: request.ip, userAgent: request.get("user-agent") };
  }
}
