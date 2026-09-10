import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: "access";
}

export interface ClientAccessTokenPayload {
  sub: string;
  sid: string;
  jti: string;
  typ: "client_access";
  cafe: string;
}

@Injectable()
export class AuthTokenService {
  private readonly accessTtlSeconds: number;
  private readonly refreshTtlDays: number;

  constructor(private readonly jwt: JwtService, config: ConfigService) {
    this.accessTtlSeconds = config.getOrThrow<number>("ACCESS_TOKEN_TTL_SECONDS");
    this.refreshTtlDays = config.getOrThrow<number>("REFRESH_TOKEN_TTL_DAYS");
  }

  issueAccessToken(userId: string, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId, jti: randomUUID(), typ: "access" };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
  }

  issueClientAccessToken(clientId: string, sessionId: string, coffeeShopId: string): Promise<string> {
    const payload: ClientAccessTokenPayload = { sub: clientId, sid: sessionId, cafe: coffeeShopId, jti: randomUUID(), typ: "client_access" };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSeconds });
  }

  refreshTokenExpiresAt(now = new Date()): Date {
    const expiresAt = new Date(now);
    expiresAt.setUTCDate(expiresAt.getUTCDate() + this.refreshTtlDays);
    return expiresAt;
  }
}
