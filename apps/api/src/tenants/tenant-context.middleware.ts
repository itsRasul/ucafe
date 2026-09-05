import { Injectable, NestMiddleware } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { NextFunction, Response } from "express";
import { In, Repository } from "typeorm";
import { CoffeeShopStatus, Domain, DomainStatus } from "../database/entities";
import { normalizeHostname } from "./hostname.util";
import { TENANT_CONTEXT, TenantContextRequest } from "./tenant-context";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { ConfigService } from "@nestjs/config";
import { trustedForwardedTenantHost } from "./proxy-trust.util";

const PUBLIC_TENANT_STATUSES = [CoffeeShopStatus.Preview, CoffeeShopStatus.Active, CoffeeShopStatus.Suspended];

@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    @InjectRepository(Domain) private readonly domains: Repository<Domain>,
    private readonly subscriptions: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  async use(request: TenantContextRequest, _response: Response, next: NextFunction): Promise<void> {
    const forwardedTenantHost = trustedForwardedTenantHost(request.headers["x-ucafe-tenant-host"], request.headers["x-ucafe-proxy-secret"], this.config.getOrThrow<string>("INTERNAL_PROXY_SECRET"));
    const rawHost = forwardedTenantHost ?? request.headers.host;
    if (!rawHost) return next();

    let hostname: string;
    try {
      hostname = normalizeHostname(rawHost);
    } catch {
      return next();
    }

    const domain = await this.domains.findOne({
      where: {
        hostname,
        status: DomainStatus.Active,
        coffeeShop: { status: In(PUBLIC_TENANT_STATUSES) },
      },
      relations: { coffeeShop: true },
    });

    if (domain) {
      const effectiveStatus = await this.subscriptions.enforceForPublicRequest(domain.coffeeShopId);
      request[TENANT_CONTEXT] = {
        coffeeShopId: domain.coffeeShopId,
        slug: domain.coffeeShop.slug,
        status: effectiveStatus,
        locale: domain.coffeeShop.defaultLocale,
        timezone: domain.coffeeShop.timezone,
        hostname: domain.hostname,
        domainType: domain.type,
      };
    }

    next();
  }
}
