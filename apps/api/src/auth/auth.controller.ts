import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Request, Response } from "express";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { AccessTokenGuard } from "./access-token.guard";
import { AuthenticationResult, AuthenticationService } from "./authentication.service";
import { RequestOtpDto } from "./dto/request-otp.dto";
import { VerifyOtpDto } from "./dto/verify-otp.dto";

const REFRESH_COOKIE = "cafexa_refresh";

@Controller("auth")
export class AuthController {
  constructor(private readonly authentication: AuthenticationService, private readonly config: ConfigService) {}

  @Post("otp/request")
  @HttpCode(HttpStatus.ACCEPTED)
  requestOtp(@Body() input: RequestOtpDto, @Req() request: Request) {
    return this.authentication.requestOtp(input.phone, this.metadata(request));
  }

  @Post("otp/verify")
  async verifyOtp(@Body() input: VerifyOtpDto, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    return this.publicResult(await this.authentication.verifyOtp(input.challengeId, input.otp, this.metadata(request)), response);
  }

  @Post("refresh")
  async refresh(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const refreshToken = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    if (!refreshToken) return this.authentication.refresh("", this.metadata(request));
    return this.publicResult(await this.authentication.refresh(refreshToken, this.metadata(request)), response);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.authentication.logout(request.cookies?.[REFRESH_COOKIE] as string | undefined);
    response.clearCookie(REFRESH_COOKIE, { path: "/api/v1/auth" });
  }

  @Get("me")
  @UseGuards(AccessTokenGuard)
  me(@Req() request: AuthorizedRequest) {
    return request[AUTH_PRINCIPAL];
  }

  private publicResult(result: AuthenticationResult, response: Response) {
    response.cookie(REFRESH_COOKIE, result.refreshToken, {
      httpOnly: true,
      secure: this.config.get<string>("NODE_ENV") === "production",
      sameSite: "lax",
      path: "/api/v1/auth",
      expires: result.refreshTokenExpiresAt,
    });
    return {
      accessToken: result.accessToken,
      accessTokenExpiresInSeconds: result.accessTokenExpiresInSeconds,
      user: result.user,
    };
  }

  private metadata(request: Request) {
    return { ip: request.ip, userAgent: request.get("user-agent") };
  }
}
