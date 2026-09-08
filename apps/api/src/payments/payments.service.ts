import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, LessThan } from "typeorm";
import { Domain, DomainStatus } from "../database/entities";
import { PlanStatus, SubscriptionPayment, SubscriptionPlan } from "../subscriptions/entities";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CreateCheckoutDto, PaymentCallbackDto } from "./dto/payment.dto";
import { PaymentIntent, PaymentIntentStatus } from "./entities";
import { PAYMENT_GATEWAY, PaymentGateway } from "./payment-gateway";

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly subscriptions: SubscriptionsService, @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}

  async checkout(coffeeShopId: string, input: CreateCheckoutDto) {
    return this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`checkout:${coffeeShopId}:${input.idempotencyKey}`]);
      const repository = manager.getRepository(PaymentIntent);
      const existing = await repository.findOneBy({ coffeeShopId, idempotencyKey: input.idempotencyKey });
      if (existing) return this.project(existing, this.payableUrl(existing));
      const plan = await manager.findOneBy(SubscriptionPlan, { key: input.planKey, status: PlanStatus.Active });
      if (!plan) throw new ConflictException("Plan is unavailable");
      let intent = await repository.save(repository.create({ coffeeShopId, planId: plan.id, planKeySnapshot: plan.key, planNameSnapshot: plan.name, amountToman: plan.priceToman, provider: "ZARINPAL", idempotencyKey: input.idempotencyKey, status: PaymentIntentStatus.Pending, expiresAt: new Date(Date.now() + 15 * 60_000) }));
      const requested = await this.gateway.request({ amountRial: this.toRial(intent.amountToman), callbackUrl: this.callbackUrl(intent.id), description: `اشتراک ${plan.name} یو کافه` });
      intent.authority = requested.authority;
      intent = await repository.save(intent);
      return this.project(intent, requested.paymentUrl);
    });
  }

  async listInvoices(coffeeShopId: string) {
    const intents = await this.db.getRepository(PaymentIntent).find({ where: { coffeeShopId }, order: { createdAt: "DESC" }, take: 30 });
    return intents.map((intent) => this.project(intent, this.payableUrl(intent)));
  }

  async getInvoice(coffeeShopId: string, intentId: string) {
    const intent = await this.db.getRepository(PaymentIntent).findOneBy({ id: intentId, coffeeShopId });
    if (!intent) throw new NotFoundException("Invoice was not found");
    return this.project(intent, this.payableUrl(intent));
  }

  async listPlatformInvoices() {
    const rows = await this.db.query<Array<PaymentIntent & { cafeName: string; cafeStatus: string; hostname: string | null }>>(
      `SELECT pi.id, pi.coffee_shop_id AS "coffeeShopId", pi.plan_id AS "planId",
        pi.plan_key_snapshot AS "planKeySnapshot", pi.plan_name_snapshot AS "planNameSnapshot",
        pi.amount_toman AS "amountToman", pi.provider, pi.authority, pi.idempotency_key AS "idempotencyKey",
        pi.status, pi.provider_reference AS "providerReference", pi.expires_at AS "expiresAt",
        pi.paid_at AS "paidAt", pi.created_at AS "createdAt", pi.updated_at AS "updatedAt",
        c.name AS "cafeName", c.status AS "cafeStatus", d.hostname
       FROM payment_intents pi
       JOIN coffee_shops c ON c.id = pi.coffee_shop_id
       LEFT JOIN domains d ON d.coffee_shop_id = c.id AND d.is_primary = true AND d.deleted_at IS NULL
       ORDER BY pi.created_at DESC
       LIMIT 100`,
    );
    return rows.map((row) => ({ ...this.project(row), cafe: { id: row.coffeeShopId, name: row.cafeName, status: row.cafeStatus, hostname: row.hostname } }));
  }

  async getPlatformInvoice(intentId: string) {
    const rows = await this.db.query<Array<PaymentIntent & { cafeName: string; cafeSlug: string; cafeStatus: string; hostname: string | null; branchName: string | null; branchPhone: string | null; branchAddress: string | null; admins: unknown }>>(
      `SELECT pi.id, pi.coffee_shop_id AS "coffeeShopId", pi.plan_id AS "planId",
        pi.plan_key_snapshot AS "planKeySnapshot", pi.plan_name_snapshot AS "planNameSnapshot",
        pi.amount_toman AS "amountToman", pi.provider, pi.authority, pi.idempotency_key AS "idempotencyKey",
        pi.status, pi.provider_reference AS "providerReference", pi.expires_at AS "expiresAt",
        pi.paid_at AS "paidAt", pi.created_at AS "createdAt", pi.updated_at AS "updatedAt",
        c.name AS "cafeName", c.slug AS "cafeSlug", c.status AS "cafeStatus", d.hostname,
        b.name AS "branchName", b.phone AS "branchPhone", b.address AS "branchAddress",
        COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
          'id', u.id, 'phone', u.phone, 'email', u.email, 'status', u.status,
          'membershipStatus', m.status, 'roles', roles.items
        )) FILTER (WHERE u.id IS NOT NULL), '[]'::jsonb) AS admins
       FROM payment_intents pi
       JOIN coffee_shops c ON c.id = pi.coffee_shop_id
       LEFT JOIN domains d ON d.coffee_shop_id = c.id AND d.is_primary = true AND d.deleted_at IS NULL
       LEFT JOIN branches b ON b.coffee_shop_id = c.id AND b.is_primary = true AND b.deleted_at IS NULL
       LEFT JOIN coffee_shop_memberships m ON m.coffee_shop_id = c.id
       LEFT JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
       LEFT JOIN LATERAL (
         SELECT COALESCE(jsonb_agg(jsonb_build_object('id', r.id, 'key', r.key, 'name', r.name) ORDER BY r.name), '[]'::jsonb) AS items
         FROM membership_roles mr JOIN roles r ON r.id = mr.role_id
         WHERE mr.membership_id = m.id
       ) roles ON true
       WHERE pi.id = $1
       GROUP BY pi.id, c.id, d.hostname, b.id`,
      [intentId],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException("Invoice was not found");
    return {
      ...this.project(row, this.payableUrl(row)),
      cafe: { id: row.coffeeShopId, name: row.cafeName, slug: row.cafeSlug, status: row.cafeStatus, hostname: row.hostname },
      branch: { name: row.branchName, phone: row.branchPhone, address: row.branchAddress },
      admins: row.admins,
    };
  }

  async callback(input: PaymentCallbackDto) {
    const repository = this.db.getRepository(PaymentIntent);
    const intent = await repository.findOneBy({ id: input.intentId, authority: input.Authority });
    if (!intent) throw new NotFoundException("Payment was not found");
    if (intent.status === PaymentIntentStatus.Paid) return this.withResultUrl(intent);
    if (input.Status !== "OK") { intent.status = PaymentIntentStatus.Failed; return this.withResultUrl(await repository.save(intent)); }
    if (intent.expiresAt <= new Date()) { intent.status = PaymentIntentStatus.Expired; return this.withResultUrl(await repository.save(intent)); }
    const prior = await this.db.getRepository(SubscriptionPayment).findOneBy({ provider: "ZARINPAL", providerReference: input.Authority });
    if (prior) { intent.status = PaymentIntentStatus.Paid; intent.paidAt = prior.paidAt; return this.withResultUrl(await repository.save(intent)); }
    if (intent.status === PaymentIntentStatus.Verifying) {
      await repository.update({ id: intent.id, status: PaymentIntentStatus.Verifying, updatedAt: LessThan(new Date(Date.now() - 5 * 60_000)) }, { status: PaymentIntentStatus.Pending });
    }
    const claim = await repository.update({ id: intent.id, status: PaymentIntentStatus.Pending }, { status: PaymentIntentStatus.Verifying });
    if (!claim.affected) throw new ConflictException("Payment verification is already in progress");
    let verified;
    try {
      verified = await this.gateway.verify({ authority: input.Authority, amountRial: this.toRial(intent.amountToman) });
    } catch {
      intent.status = PaymentIntentStatus.Failed;
      return this.withResultUrl(await repository.save(intent));
    }
    const result = await this.subscriptions.recordPrepaidMonth(intent.coffeeShopId, { planKey: intent.planKeySnapshot, provider: "ZARINPAL", providerReference: input.Authority });
    intent.status = PaymentIntentStatus.Paid; intent.providerReference = verified.reference; intent.paidAt = result.payment.paidAt;
    return this.withResultUrl(await repository.save(intent));
  }

  private toRial(amountToman: string) { const amount = Number(amountToman); if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 10)) throw new ConflictException("Payment amount is invalid"); return amount * 10; }
  private callbackUrl(intentId: string) { const base = this.config.getOrThrow<string>("PAYMENT_CALLBACK_BASE_URL").replace(/\/$/, ""); return `${base}/api/v1/public/payments/callback?intentId=${intentId}`; }
  private payableUrl(intent: PaymentIntent) { return intent.status === PaymentIntentStatus.Pending && intent.authority && intent.expiresAt > new Date() ? this.gateway.paymentUrl(intent.authority, this.callbackUrl(intent.id)) : undefined; }
  private async resultUrl(intent: PaymentIntent) {
    const domain = await this.db.getRepository(Domain).findOne({ where: { coffeeShopId: intent.coffeeShopId, isPrimary: true, status: DomainStatus.Active } });
    const protocol = new URL(this.config.getOrThrow<string>("PAYMENT_CALLBACK_BASE_URL")).protocol;
    const host = domain?.hostname ?? this.config.getOrThrow<string>("PLATFORM_BASE_DOMAIN");
    return `${protocol}//${host}/admin/subscription/payment-result?intentId=${intent.id}&status=${intent.status}`;
  }
  private async withResultUrl(intent: PaymentIntent) { return { ...this.project(intent), redirectUrl: await this.resultUrl(intent) }; }
  private project(intent: PaymentIntent, paymentUrl?: string) { return { id: intent.id, status: intent.status, amountToman: intent.amountToman, plan: { key: intent.planKeySnapshot, name: intent.planNameSnapshot }, authority: intent.authority, providerReference: intent.providerReference, createdAt: intent.createdAt, expiresAt: intent.expiresAt, paidAt: intent.paidAt, ...(paymentUrl ? { paymentUrl } : {}) }; }
}
