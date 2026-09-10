import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { InjectRepository } from "@nestjs/typeorm";
import { IsNull, MoreThan, Repository } from "typeorm";
import { ClientAccessTokenPayload } from "../auth/auth-token.service";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "./client-principal";
import { ClientAuthSession, ClientStatus } from "./entities";

@Injectable()
export class ClientAccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @InjectRepository(ClientAuthSession) private readonly sessions: Repository<ClientAuthSession>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<TenantContextRequest & ClientAuthorizedRequest & { headers: { authorization?: string } }>();
    const tenant = request[TENANT_CONTEXT];
    const authorization = request.headers.authorization;
    if (!tenant || !authorization?.startsWith("Bearer ")) throw new UnauthorizedException();
    try {
      const payload = await this.jwt.verifyAsync<ClientAccessTokenPayload>(authorization.slice(7));
      if (payload.typ !== "client_access" || payload.cafe !== tenant.coffeeShopId || !payload.sub || !payload.sid || !payload.jti) throw new UnauthorizedException();
      const session = await this.sessions.findOne({
        where: {
          id: payload.sid,
          clientId: payload.sub,
          coffeeShopId: tenant.coffeeShopId,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
          client: { status: ClientStatus.Active },
        },
        relations: { client: true },
      });
      if (!session) throw new UnauthorizedException();
      request[CLIENT_PRINCIPAL] = { clientId: payload.sub, sessionId: payload.sid, coffeeShopId: tenant.coffeeShopId };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
