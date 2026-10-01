import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, IsNull } from "typeorm";
import { CoffeeShop, CoffeeShopStatus, Domain } from "../database/entities";
import { User, UserStatus } from "../identity/entities";
import { PlanStatus, Subscription, SubscriptionPlan } from "../subscriptions/entities";
import { publicPlanCatalog } from "../subscriptions/public-plan.util";
import { SubscriptionsService, SubscriptionQuote } from "../subscriptions/subscriptions.service";
import { buildTenantHostname } from "../tenants/hostname.util";
import { TenantsService } from "../tenants/tenants.service";
import { CreateCheckoutDto } from "./dto/payment.dto";
import { PreparePurchaseDto } from "./dto/public-purchase.dto";
import { PaymentsService } from "./payments.service";
import { PaymentIntent } from "./entities";

@Injectable()
export class PublicPurchaseService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly tenants: TenantsService, private readonly subscriptions: SubscriptionsService, private readonly payments: PaymentsService) {}

  async catalog() {
    return { plans: publicPlanCatalog(await this.db.getRepository(SubscriptionPlan).findBy({ status: PlanStatus.Active })) };
  }

  async availability(slug: string) {
    const hostname = buildTenantHostname(slug, this.config.getOrThrow<string>("PLATFORM_BASE_DOMAIN"));
    const taken = await this.db.getRepository(CoffeeShop).exists({ where: { slug }, withDeleted: true }) || await this.db.getRepository(Domain).exists({ where: { hostname }, withDeleted: true });
    return { hostname, available: !taken };
  }

  async prepare(userId: string, input: PreparePurchaseDto) {
    return this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`public-purchase:${userId}`]);
      const user = await manager.findOneBy(User, { id: userId, status: UserStatus.Active, deletedAt: IsNull() });
      if (!user?.phone || !user.phoneVerifiedAt) throw new ForbiddenException("Verified identity is required");
      if (!await manager.existsBy(SubscriptionPlan, { key: input.planKey, status: PlanStatus.Active })) throw new ConflictException("Plan is unavailable");
      let cafe = await manager.getRepository(CoffeeShop).findOne({ where: { slug: input.slug }, withDeleted: true });
      if (cafe) {
        await this.ownedCafe(manager, userId, input.slug);
        if (cafe.status !== CoffeeShopStatus.Draft || await manager.existsBy(Subscription, { coffeeShopId: cafe.id })) throw new ConflictException("Use the cafe subscription panel");
      } else {
        // One unfinished cafe per verified owner; reuse it rather than reserve more hostnames.
        const drafts = await manager.query("SELECT 1 FROM coffee_shops c JOIN coffee_shop_memberships m ON m.coffee_shop_id=c.id WHERE m.user_id=$1 AND c.status='DRAFT' AND c.deleted_at IS NULL LIMIT 1", [userId]);
        if (drafts.length) throw new ConflictException("Continue your unfinished cafe first");
        const tenant = await this.tenants.provision({ name: input.name, slug: input.slug, ownerPhone: user.phone }, manager);
        cafe = await manager.findOneByOrFail(CoffeeShop, { id: tenant.coffeeShopId });
      }
      const quote = await this.subscriptions.quote(manager, cafe.id, input.planKey, new Date());
      return { slug: cafe.slug, name: cafe.name, hostname: buildTenantHostname(cafe.slug, this.config.getOrThrow<string>("PLATFORM_BASE_DOMAIN")), quote: this.projectQuote(quote) };
    });
  }

  async drafts(userId: string) {
    return this.db.query<Array<{ slug: string; name: string; hostname: string }>>("SELECT c.slug,c.name,d.hostname FROM coffee_shops c JOIN coffee_shop_memberships m ON m.coffee_shop_id=c.id JOIN domains d ON d.coffee_shop_id=c.id AND d.is_primary=true AND d.deleted_at IS NULL WHERE m.user_id=$1 AND m.status='ACTIVE' AND c.status='DRAFT' AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 1", [userId]);
  }

  async cafes(userId: string) {
    return this.db.query<Array<{ slug: string; name: string; hostname: string }>>("SELECT c.slug,c.name,d.hostname FROM coffee_shops c JOIN coffee_shop_memberships m ON m.coffee_shop_id=c.id JOIN domains d ON d.coffee_shop_id=c.id AND d.is_primary=true AND d.status='ACTIVE' AND d.deleted_at IS NULL WHERE m.user_id=$1 AND m.status='ACTIVE' AND c.status IN ('ACTIVE','PREVIEW','SUSPENDED') AND c.deleted_at IS NULL ORDER BY c.created_at DESC LIMIT 20", [userId]);
  }

  async checkout(userId: string, slug: string, input: CreateCheckoutDto) {
    const cafe = await this.ownedCafe(this.db.manager, userId, slug);
    const existing = await this.db.getRepository(PaymentIntent).existsBy({ coffeeShopId: cafe.id, idempotencyKey: input.idempotencyKey });
    if (cafe.status !== CoffeeShopStatus.Draft && !existing) throw new ConflictException("Use the cafe subscription panel");
    return this.payments.checkout(cafe.id, input, true);
  }

  async invoices(userId: string, slug: string) {
    const cafe = await this.ownedCafe(this.db.manager, userId, slug);
    return this.payments.listInvoices(cafe.id);
  }

  async invoice(userId: string, slug: string, intentId: string) {
    const cafe = await this.ownedCafe(this.db.manager, userId, slug);
    return { ...await this.payments.getInvoice(cafe.id, intentId), cafe: { name: cafe.name, slug: cafe.slug, hostname: buildTenantHostname(cafe.slug, this.config.getOrThrow<string>("PLATFORM_BASE_DOMAIN")) } };
  }

  private async ownedCafe(manager: EntityManager, userId: string, slug: string) {
    const rows = await manager.query<Array<{ id: string }>>(`SELECT c.id FROM coffee_shops c JOIN coffee_shop_memberships m ON m.coffee_shop_id=c.id
      JOIN membership_roles mr ON mr.membership_id=m.id JOIN roles r ON r.id=mr.role_id
      JOIN role_permissions rp ON rp.role_id=r.id JOIN permissions p ON p.id=rp.permission_id
      WHERE c.slug=$1 AND c.deleted_at IS NULL AND m.user_id=$2 AND m.status='ACTIVE'
      AND r.scope='TENANT' AND (r.coffee_shop_id IS NULL OR r.coffee_shop_id=c.id) AND p.key='subscription.checkout' LIMIT 1`, [slug, userId]);
    if (!rows[0]) throw new NotFoundException("Cafe is unavailable");
    return manager.findOneByOrFail(CoffeeShop, { id: rows[0].id });
  }

  private projectQuote(quote: SubscriptionQuote) {
    return { amountToman: quote.amountToman, planKey: quote.targetPlan.key, planName: quote.targetPlan.name, billingMonths: quote.targetPlan.billingMonths, expectedSubscriptionVersion: quote.subscriptionVersion, expectedPlanUpdatedAt: quote.targetPlan.updatedAt.toISOString() };
  }
}
