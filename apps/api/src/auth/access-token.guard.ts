import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { JwtService } from "@nestjs/jwt";
import { IsNull, MoreThan, Repository } from "typeorm";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { UserStatus } from "../identity/entities";
import { AccessTokenPayload } from "./auth-token.service";
import { AuthSession } from "./entities";

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthorizedRequest & { headers: { authorization?: string } }>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(authorization.slice(7));
      if (payload.typ !== "access" || !payload.sub || !payload.sid || !payload.jti) throw new UnauthorizedException();
      const session = await this.sessions.findOne({
        where: {
          id: payload.sid,
          userId: payload.sub,
          revokedAt: IsNull(),
          expiresAt: MoreThan(new Date()),
          user: { status: UserStatus.Active, deletedAt: IsNull() },
        },
        relations: { user: true },
      });
      if (!session) throw new UnauthorizedException();
      request[AUTH_PRINCIPAL] = { userId: payload.sub, sessionId: payload.sid };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
