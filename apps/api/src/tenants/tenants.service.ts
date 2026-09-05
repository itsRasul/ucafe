import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, IsNull, QueryFailedError } from "typeorm";
import { Branch, CoffeeShop, CoffeeShopStatus, Domain, DomainStatus, DomainType } from "../database/entities";
import { AuthorizationScope, CoffeeShopMembership, MembershipRole, MembershipStatus, Role, User, UserStatus } from "../identity/entities";
import { normalizeIranianMobile } from "../auth/iran-phone.util";
import { WebsiteSettings } from "../site/entities";
import { ReservationSettings } from "../reservations/entities";
import { buildTenantHostname } from "./hostname.util";

export interface ProvisionTenantInput {
  name: string;
  slug: string;
  ownerPhone?: string;
  invitedByUserId?: string;
}

export interface ProvisionedTenant {
  coffeeShopId: string;
  branchId: string;
  domainId: string;
  hostname: string;
  ownerMembershipId?: string;
  ownerMembershipStatus?: MembershipStatus;
}

@Injectable()
export class TenantsService {
  constructor(private readonly dataSource: DataSource, private readonly config: ConfigService) {}

  async listForPlatform() {
    const shops = await this.dataSource.getRepository(CoffeeShop).find({ order: { createdAt: "DESC" } });
    const domains = await this.dataSource.getRepository(Domain).findBy({ isPrimary: true });
    return shops.map((shop) => ({ id: shop.id, name: shop.name, slug: shop.slug, status: shop.status, hostname: domains.find((domain) => domain.coffeeShopId === shop.id)?.hostname ?? null, createdAt: shop.createdAt, publishedAt: shop.publishedAt, suspendedAt: shop.suspendedAt }));
  }

  async getForPlatform(coffeeShopId: string) {
    const shop = await this.dataSource.getRepository(CoffeeShop).findOneBy({ id: coffeeShopId });
    if (!shop) throw new NotFoundException("Coffee shop not found");
    const branch = await this.dataSource.getRepository(Branch).findOneBy({ coffeeShopId, isPrimary: true });
    const domain = await this.dataSource.getRepository(Domain).findOneBy({ coffeeShopId, isPrimary: true });
    const memberships = await this.dataSource.getRepository(CoffeeShopMembership).find({ where: { coffeeShopId }, order: { createdAt: "ASC" } });
    return { id: shop.id, name: shop.name, slug: shop.slug, status: shop.status, defaultLocale: shop.defaultLocale, timezone: shop.timezone, createdAt: shop.createdAt, publishedAt: shop.publishedAt, suspendedAt: shop.suspendedAt, branch: branch ? { id: branch.id, name: branch.name, phone: branch.phone, address: branch.address, isActive: branch.isActive } : null, domain: domain ? { hostname: domain.hostname, status: domain.status } : null, memberships: memberships.map((membership) => ({ id: membership.id, status: membership.status, invitedAt: membership.invitedAt, acceptedAt: membership.acceptedAt })) };
  }

  async provision(input: ProvisionTenantInput): Promise<ProvisionedTenant> {
    const name = input.name.trim();
    const slug = input.slug.trim().toLowerCase();
    if (!name || name.length > 160) throw new BadRequestException("Tenant name must contain 1 to 160 characters");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new BadRequestException("Tenant slug is invalid");

    const hostname = buildTenantHostname(slug, this.config.getOrThrow<string>("PLATFORM_BASE_DOMAIN"));

    try {
      return await this.dataSource.transaction(async (manager) => {
        const coffeeShop = await manager.save(CoffeeShop, manager.create(CoffeeShop, {
          name,
          slug,
          status: CoffeeShopStatus.Draft,
        }));
        const branch = await manager.save(Branch, manager.create(Branch, {
          coffeeShopId: coffeeShop.id,
          name: "شعبه اصلی",
          slug: "main",
          isPrimary: true,
          timezone: coffeeShop.timezone,
        }));
        const domain = await manager.save(Domain, manager.create(Domain, {
          coffeeShopId: coffeeShop.id,
          hostname,
          type: DomainType.PlatformSubdomain,
          status: DomainStatus.Active,
          isPrimary: true,
          verifiedAt: new Date(),
        }));

        await manager.save(WebsiteSettings, manager.create(WebsiteSettings, { coffeeShopId: coffeeShop.id }));
        await manager.save(ReservationSettings, manager.create(ReservationSettings, { branchId: branch.id }));

        let ownerMembership: CoffeeShopMembership | undefined;
        if (input.ownerPhone) {
          const phone = normalizeIranianMobile(input.ownerPhone);
          await manager.createQueryBuilder().insert().into(User).values({ phone, status: UserStatus.Active }).orIgnore().execute();
          const owner = await manager.findOneByOrFail(User, { phone });
          const ownerRole = await manager.findOneByOrFail(Role, {
            key: "owner",
            scope: AuthorizationScope.Tenant,
            coffeeShopId: IsNull(),
          });
          const isVerified = Boolean(owner.phoneVerifiedAt);
          const membershipTime = new Date();
          ownerMembership = await manager.save(CoffeeShopMembership, manager.create(CoffeeShopMembership, {
            coffeeShopId: coffeeShop.id,
            userId: owner.id,
            status: isVerified ? MembershipStatus.Active : MembershipStatus.Invited,
            invitedByUserId: input.invitedByUserId ?? null,
            invitedAt: membershipTime,
            acceptedAt: isVerified ? membershipTime : null,
          }));
          await manager.save(MembershipRole, manager.create(MembershipRole, {
            membershipId: ownerMembership.id,
            roleId: ownerRole.id,
          }));
        }

        return {
          coffeeShopId: coffeeShop.id,
          branchId: branch.id,
          domainId: domain.id,
          hostname,
          ...(ownerMembership ? {
            ownerMembershipId: ownerMembership.id,
            ownerMembershipStatus: ownerMembership.status,
          } : {}),
        };
      });
    } catch (error) {
      if (error instanceof QueryFailedError && (error.driverError as { code?: string }).code === "23505") {
        throw new ConflictException("A coffee shop with this slug or hostname already exists");
      }
      throw error;
    }
  }
}
