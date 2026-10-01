import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { CoffeeShop, CoffeeShopStatus, Domain, DomainStatus } from "../database/entities";
import { NotificationType } from "../notifications/notification-type";
import { NotificationsService } from "../notifications/notifications.service";
import { SubscriptionOperation, SubscriptionPayment } from "../subscriptions/entities";
import { SubscriptionQuote, SubscriptionsService } from "../subscriptions/subscriptions.service";
import { CreateCheckoutDto, PaymentCallbackDto } from "./dto/payment.dto";
import { PaymentIntent, PaymentIntentStatus } from "./entities";
import { PAYMENT_GATEWAY, PaymentGateway } from "./payment-gateway";

@Injectable()
export class PaymentsService {
  constructor(private readonly db: DataSource, private readonly config: ConfigService, private readonly subscriptions: SubscriptionsService, private readonly notifications: NotificationsService, @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}

  async checkout(coffeeShopId: string, input: CreateCheckoutDto, purchaseOnly = false) {
    const prepared = await this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`subscription:${coffeeShopId}`]);
      const repository = manager.getRepository(PaymentIntent);
      const existing = await repository.findOneBy({ coffeeShopId, idempotencyKey: input.idempotencyKey });
      if (existing) return { intent: existing, existing: true };
      await repository.createQueryBuilder().update().set({ status: PaymentIntentStatus.Expired }).where("coffee_shop_id=:coffeeShopId AND status=:status AND expires_at<=:now", { coffeeShopId, status: PaymentIntentStatus.Pending, now: new Date() }).execute();
      if (await repository.existsBy({ coffeeShopId, status: PaymentIntentStatus.Pending }) || await repository.existsBy({ coffeeShopId, status: PaymentIntentStatus.Verifying })) throw new ConflictException("A payment is already in progress");
      const quote = await this.subscriptions.quote(manager, coffeeShopId, input.planKey, new Date());
      if (purchaseOnly && (quote.operation !== SubscriptionOperation.Purchase || !await manager.existsBy(CoffeeShop, { id: coffeeShopId, status: CoffeeShopStatus.Draft }))) throw new ConflictException("Use the cafe subscription panel");
      if (!quote.operation || quote.action === "SCHEDULE_DOWNGRADE" || quote.action === "CHANGE_DOWNGRADE") throw new ConflictException("This plan change does not require checkout");
      if (quote.subscriptionVersion !== input.expectedSubscriptionVersion || quote.targetPlan.updatedAt.toISOString() !== new Date(input.expectedPlanUpdatedAt).toISOString()) throw new ConflictException("Subscription pricing changed; refresh the preview");
      const intent = await repository.save(repository.create({
        coffeeShopId, planId: quote.targetPlan.id, planKeySnapshot: quote.targetPlan.key, planNameSnapshot: quote.targetPlan.name, planPriceSnapshot: quote.targetPlan.priceToman, billingMonthsSnapshot: quote.targetPlan.billingMonths,
        sourcePlanKeySnapshot: quote.sourcePlan?.key ?? null, sourcePlanNameSnapshot: quote.sourcePlan?.name ?? null, sourcePlanPriceSnapshot: quote.sourcePlan?.priceToman ?? null, sourceBillingMonthsSnapshot: quote.sourcePlan?.billingMonths ?? null,
        operation: quote.operation, amountToman: quote.amountToman, pricingSnapshot: quote.pricing,
        subscriptionVersionSnapshot: quote.subscriptionVersion, periodStartedAt: quote.periodStartedAt, periodEndsAt: quote.periodEndsAt,
        effectiveTiming: quote.effectiveTiming, provider: "ZARINPAL", idempotencyKey: input.idempotencyKey,
        status: PaymentIntentStatus.Pending, expiresAt: new Date(Date.now() + 15 * 60_000),
      }));
      return { intent, existing: false };
    });
    if (prepared.existing) return this.project(prepared.intent, this.payableUrl(prepared.intent));
    try {
      const requested = await this.gateway.request({ amountRial: this.toRial(prepared.intent.amountToman), callbackUrl: this.callbackUrl(prepared.intent.id), description: `اشتراک ${prepared.intent.planNameSnapshot} یو کافه` });
      const repository = this.db.getRepository(PaymentIntent);
      await repository.update({ id: prepared.intent.id, status: PaymentIntentStatus.Pending }, { authority: requested.authority });
      const saved = await repository.findOneByOrFail({ id: prepared.intent.id });
      return this.project(saved, this.payableUrl(saved));
    } catch (error) {
      await this.db.getRepository(PaymentIntent).update({ id: prepared.intent.id, status: PaymentIntentStatus.Pending }, { status: PaymentIntentStatus.Failed });
      throw error;
    }
  }

  async listInvoices(coffeeShopId: string) { return (await this.db.getRepository(PaymentIntent).find({ where: { coffeeShopId }, order: { createdAt: "DESC" }, take: 30 })).map((intent) => this.project(intent, this.payableUrl(intent))); }
  async getInvoice(coffeeShopId: string, intentId: string) { const intent = await this.db.getRepository(PaymentIntent).findOneBy({ id: intentId, coffeeShopId }); if (!intent) throw new NotFoundException("Invoice was not found"); return this.project(intent, this.payableUrl(intent)); }

  async listPlatformInvoices() {
    const rows = await this.db.query<Array<PaymentIntent & { cafeName: string; cafeStatus: string; hostname: string | null }>>(`SELECT pi.*, c.name AS "cafeName", c.status AS "cafeStatus", d.hostname FROM payment_intents pi JOIN coffee_shops c ON c.id=pi.coffee_shop_id LEFT JOIN domains d ON d.coffee_shop_id=c.id AND d.is_primary=true AND d.deleted_at IS NULL ORDER BY pi.created_at DESC LIMIT 100`);
    return rows.map((row) => ({ ...this.project(this.hydrate(row)), cafe: { id: row.coffeeShopId, name: row.cafeName, status: row.cafeStatus, hostname: row.hostname } }));
  }

  async getPlatformInvoice(intentId: string) {
    const rows = await this.db.query<Array<PaymentIntent & { cafeName: string; cafeSlug: string; cafeStatus: string; hostname: string | null; branchName: string | null; branchPhone: string | null; branchAddress: string | null; admins: unknown }>>(`SELECT pi.*, c.name AS "cafeName", c.slug AS "cafeSlug", c.status AS "cafeStatus", d.hostname, b.name AS "branchName", b.phone AS "branchPhone", b.address AS "branchAddress", COALESCE(jsonb_agg(DISTINCT jsonb_build_object('id',u.id,'phone',u.phone,'email',u.email,'status',u.status,'membershipStatus',m.status,'roles',roles.items)) FILTER (WHERE u.id IS NOT NULL),'[]'::jsonb) AS admins FROM payment_intents pi JOIN coffee_shops c ON c.id=pi.coffee_shop_id LEFT JOIN domains d ON d.coffee_shop_id=c.id AND d.is_primary=true AND d.deleted_at IS NULL LEFT JOIN branches b ON b.coffee_shop_id=c.id AND b.is_primary=true AND b.deleted_at IS NULL LEFT JOIN coffee_shop_memberships m ON m.coffee_shop_id=c.id LEFT JOIN users u ON u.id=m.user_id AND u.deleted_at IS NULL LEFT JOIN LATERAL (SELECT COALESCE(jsonb_agg(jsonb_build_object('id',r.id,'key',r.key,'name',r.name) ORDER BY r.name),'[]'::jsonb) items FROM membership_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.membership_id=m.id) roles ON true WHERE pi.id=$1 GROUP BY pi.id,c.id,d.hostname,b.id`, [intentId]);
    const row = rows[0]; if (!row) throw new NotFoundException("Invoice was not found");
    return { ...this.project(this.hydrate(row), this.payableUrl(this.hydrate(row))), cafe: { id: row.coffeeShopId, name: row.cafeName, slug: row.cafeSlug, status: row.cafeStatus, hostname: row.hostname }, branch: { name: row.branchName, phone: row.branchPhone, address: row.branchAddress }, admins: row.admins };
  }

  async callback(input: PaymentCallbackDto) {
    const repository = this.db.getRepository(PaymentIntent);
    const claimed = await this.db.transaction(async (manager) => {
      const intent = await manager.getRepository(PaymentIntent).createQueryBuilder("intent").setLock("pessimistic_write").where("intent.id=:id AND intent.authority=:authority", { id: input.intentId, authority: input.Authority }).getOne();
      if (!intent) throw new NotFoundException("Payment was not found");
      if (intent.status === PaymentIntentStatus.Paid) return { intent, verify: false };
      const prior = await manager.findOneBy(SubscriptionPayment, { paymentIntentId: intent.id });
      if (prior) {
        intent.status = PaymentIntentStatus.Paid; intent.providerReference = prior.providerReference; intent.paidAt = prior.paidAt;
        return { intent: await manager.save(intent), verify: false };
      }
      if (intent.status === PaymentIntentStatus.Verifying && intent.updatedAt.getTime() > Date.now() - 5 * 60_000) return { intent, verify: false };
      if (![PaymentIntentStatus.Pending, PaymentIntentStatus.Verifying].includes(intent.status)) return { intent, verify: false };
      if (input.Status !== "OK" || intent.expiresAt <= new Date()) {
        intent.status = input.Status !== "OK" ? PaymentIntentStatus.Canceled : PaymentIntentStatus.Expired;
        return { intent: await manager.save(intent), verify: false };
      }
      intent.status = PaymentIntentStatus.Verifying;
      return { intent: await manager.save(intent), verify: true };
    });
    const intent = claimed.intent;
    if (!claimed.verify) return this.withResultUrl(intent);
    let verified;
    try { verified = await this.gateway.verify({ authority: input.Authority, amountRial: this.toRial(intent.amountToman) }); }
    catch {
      await repository.update({ id: intent.id, status: PaymentIntentStatus.Verifying }, { status: PaymentIntentStatus.Failed });
      const saved = await repository.findOneByOrFail({ id: intent.id });
      if (saved.status === PaymentIntentStatus.Failed) await this.enqueueFailedPayment(saved);
      return this.withResultUrl(saved);
    }
    const paidAt = new Date();
    const saved = await this.db.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`subscription:${intent.coffeeShopId}`]);
      const locked = await manager.getRepository(PaymentIntent).createQueryBuilder("intent").setLock("pessimistic_write").where("intent.id=:id", { id: intent.id }).getOneOrFail();
      if (locked.status === PaymentIntentStatus.Paid) return locked;
      const duplicate = await manager.findOneBy(SubscriptionPayment, { paymentIntentId: intent.id });
      if (!duplicate) await this.subscriptions.applyPaidQuote(manager, intent.coffeeShopId, this.intentQuote(intent), { provider: "ZARINPAL", providerReference: verified.reference, providerAuthority: input.Authority, paymentIntentId: intent.id }, paidAt);
      locked.status = PaymentIntentStatus.Paid; locked.providerReference = verified.reference; locked.paidAt = paidAt; return manager.save(locked);
    });
    return this.withResultUrl(saved);
  }

  private intentQuote(intent: PaymentIntent): SubscriptionQuote {
    const pricing = intent.pricingSnapshot as SubscriptionQuote["pricing"];
    return { action: this.actionFor(intent.operation), operation: intent.operation, subscriptionVersion: intent.subscriptionVersionSnapshot ?? 0, targetPlan: { id: intent.planId, key: intent.planKeySnapshot, name: intent.planNameSnapshot, priceToman: intent.planPriceSnapshot, billingMonths: intent.billingMonthsSnapshot, updatedAt: intent.updatedAt }, sourcePlan: intent.sourcePlanKeySnapshot ? { key: intent.sourcePlanKeySnapshot, name: intent.sourcePlanNameSnapshot ?? intent.sourcePlanKeySnapshot, priceToman: intent.sourcePlanPriceSnapshot ?? "0", billingMonths: intent.sourceBillingMonthsSnapshot ?? 1 } : null, amountToman: intent.amountToman, pricing, effectiveTiming: intent.effectiveTiming as SubscriptionQuote["effectiveTiming"], periodStartedAt: intent.periodStartedAt, periodEndsAt: intent.periodEndsAt, currentAccessEndsAt: intent.periodEndsAt };
  }
  private actionFor(operation: SubscriptionOperation): SubscriptionQuote["action"] { return operation === SubscriptionOperation.Upgrade ? "UPGRADE" : operation === SubscriptionOperation.Reactivation ? "REACTIVATE" : operation === SubscriptionOperation.TrialToPaid ? "TRIAL_TO_PAID" : operation === SubscriptionOperation.Purchase ? "PURCHASE" : "RENEW"; }
  private toRial(amountToman: string) { const amount = Number(amountToman); if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 10)) throw new ConflictException("Payment amount is invalid"); return amount * 10; }
  private async enqueueFailedPayment(intent: PaymentIntent) { await this.db.transaction(async (manager) => { const cafe = await manager.findOneByOrFail(CoffeeShop, { id: intent.coffeeShopId }); await this.notifications.enqueueOwners(manager, { coffeeShopId: intent.coffeeShopId, type: NotificationType.SubscriptionPaymentFailed, relatedEntityType: "payment_intent", relatedEntityId: intent.id, deduplicationKey: `${NotificationType.SubscriptionPaymentFailed}:${intent.id}`, payload: { cafeName: cafe.name, planName: intent.planNameSnapshot } }); }); }
  private callbackUrl(intentId: string) { return `${this.config.getOrThrow<string>("PAYMENT_CALLBACK_BASE_URL").replace(/\/$/, "")}/api/v1/public/payments/callback?intentId=${intentId}`; }
  private payableUrl(intent: PaymentIntent) { return intent.status === PaymentIntentStatus.Pending && intent.authority && intent.expiresAt > new Date() ? this.gateway.paymentUrl(intent.authority, this.callbackUrl(intent.id)) : undefined; }
  private async resultUrl(intent: PaymentIntent) {
    if (intent.operation === SubscriptionOperation.Purchase) {
      const cafe = await this.db.getRepository(CoffeeShop).findOneByOrFail({ id: intent.coffeeShopId });
      const url = new URL("/start/result", this.config.getOrThrow<string>("PLATFORM_PUBLIC_URL"));
      url.searchParams.set("slug", cafe.slug); url.searchParams.set("intentId", intent.id);
      return url.toString();
    }
    const domain = await this.db.getRepository(Domain).findOne({ where: { coffeeShopId: intent.coffeeShopId, isPrimary: true, status: DomainStatus.Active } });
    const origin = new URL(this.config.getOrThrow<string>("PLATFORM_PUBLIC_URL"));
    if (domain) origin.hostname = domain.hostname;
    origin.pathname = "/admin/subscription/payment-result";
    origin.search = `?intentId=${intent.id}`;
    return origin.toString();
  }
  private async withResultUrl(intent: PaymentIntent) { return { ...this.project(intent), redirectUrl: await this.resultUrl(intent) }; }
  private project(intent: PaymentIntent, paymentUrl?: string) { return { id: intent.id, status: intent.status, operation: intent.operation, amountToman: intent.amountToman, pricing: intent.pricingSnapshot, plan: { key: intent.planKeySnapshot, name: intent.planNameSnapshot, priceToman: intent.planPriceSnapshot, billingMonths: intent.billingMonthsSnapshot }, sourcePlan: intent.sourcePlanKeySnapshot ? { key: intent.sourcePlanKeySnapshot, name: intent.sourcePlanNameSnapshot, priceToman: intent.sourcePlanPriceSnapshot, billingMonths: intent.sourceBillingMonthsSnapshot } : null, effectiveTiming: intent.effectiveTiming, periodStartedAt: intent.periodStartedAt, periodEndsAt: intent.periodEndsAt, authority: intent.authority, providerReference: intent.providerReference, createdAt: intent.createdAt, expiresAt: intent.expiresAt, paidAt: intent.paidAt, ...(paymentUrl ? { paymentUrl } : {}) }; }
  private hydrate(row: PaymentIntent) { const value = row as unknown as Record<string, unknown>; const pick = (camel: string, snake: string) => value[camel] ?? value[snake]; return Object.assign(row, { coffeeShopId: pick("coffeeShopId", "coffee_shop_id"), planId: pick("planId", "plan_id"), planKeySnapshot: pick("planKeySnapshot", "plan_key_snapshot"), planNameSnapshot: pick("planNameSnapshot", "plan_name_snapshot"), planPriceSnapshot: pick("planPriceSnapshot", "plan_price_snapshot"), billingMonthsSnapshot: pick("billingMonthsSnapshot", "billing_months_snapshot"), sourcePlanKeySnapshot: pick("sourcePlanKeySnapshot", "source_plan_key_snapshot"), sourcePlanNameSnapshot: pick("sourcePlanNameSnapshot", "source_plan_name_snapshot"), sourcePlanPriceSnapshot: pick("sourcePlanPriceSnapshot", "source_plan_price_snapshot"), sourceBillingMonthsSnapshot: pick("sourceBillingMonthsSnapshot", "source_billing_months_snapshot"), amountToman: pick("amountToman", "amount_toman"), pricingSnapshot: pick("pricingSnapshot", "pricing_snapshot"), effectiveTiming: pick("effectiveTiming", "effective_timing"), periodStartedAt: pick("periodStartedAt", "period_started_at"), periodEndsAt: pick("periodEndsAt", "period_ends_at"), providerReference: pick("providerReference", "provider_reference"), expiresAt: pick("expiresAt", "expires_at"), paidAt: pick("paidAt", "paid_at"), createdAt: pick("createdAt", "created_at"), updatedAt: pick("updatedAt", "updated_at") }); }
}
