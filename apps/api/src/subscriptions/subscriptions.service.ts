import { ConflictException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, MoreThan } from "typeorm";
import { CoffeeShop, CoffeeShopStatus } from "../database/entities";
import { NotificationType } from "../notifications/notification-type";
import { NotificationsService } from "../notifications/notifications.service";
import { UpdatePlanDto } from "./dto/update-plan.dto";
import { PlanStatus, Subscription, SubscriptionOperation, SubscriptionPayment, SubscriptionPaymentStatus, SubscriptionPeriod, SubscriptionPlan, SubscriptionStatus } from "./entities";
import { mergePlanFeatures, projectPlanFeatures, subscriptionFeatureCatalog, SubscriptionFeatureKey } from "./subscription-features";
import { addDays, addUtcMonths, effectiveSubscriptionStatus, prorateToman } from "./subscription-lifecycle";
import { renewalWindow } from "./subscription-summary.util";

export type SubscriptionAction = "PURCHASE" | "RENEW" | "UPGRADE" | "SCHEDULE_DOWNGRADE" | "CHANGE_DOWNGRADE" | "REACTIVATE" | "TRIAL_TO_PAID" | "NONE";
export type SubscriptionQuote = {
  action: SubscriptionAction;
  operation: SubscriptionOperation | null;
  subscriptionVersion: number;
  targetPlan: { id: string; key: string; name: string; priceToman: string; billingMonths: number; updatedAt: Date };
  sourcePlan: { key: string; name: string; priceToman: string; billingMonths: number } | null;
  amountToman: string;
  pricing: { sourceCreditToman: string; targetCostToman: string; amountDueToman: string };
  effectiveTiming: "ON_PAYMENT" | "PERIOD_END" | "NONE";
  periodStartedAt: Date | null;
  periodEndsAt: Date | null;
  currentAccessEndsAt: Date | null;
};

@Injectable()
export class SubscriptionsService {
  constructor(private readonly dataSource: DataSource, private readonly notifications: NotificationsService) {}

  async listPlans() { return this.dataSource.getRepository(SubscriptionPlan).find({ order: { sortOrder: "ASC" } }); }

  async updatePlan(planKey: string, input: UpdatePlanDto) {
    const repository = this.dataSource.getRepository(SubscriptionPlan);
    const plan = await repository.findOneBy({ key: planKey });
    if (!plan) throw new NotFoundException("Subscription plan not found");
    if (input.sortOrder != null) {
      const owner = await repository.findOneBy({ sortOrder: input.sortOrder });
      if (owner && owner.id !== plan.id) throw new ConflictException("Plan order is already in use");
    }
    if (input.name != null) plan.name = input.name.trim();
    if (input.description != null) plan.description = input.description.trim();
    if (input.priceToman != null) plan.priceToman = input.priceToman.toString();
    if (input.sortOrder != null) plan.sortOrder = input.sortOrder;
    if (input.billingMonths != null) plan.billingMonths = input.billingMonths;
    if (input.status != null) plan.status = input.status;
    if (input.trialDays != null) plan.trialDays = input.trialDays;
    if (input.graceDays != null) plan.graceDays = input.graceDays;
    if (input.features != null) plan.features = mergePlanFeatures(plan.features, input.features);
    if (input.highlightedFeatureKeys != null) plan.highlightedFeatureKeys = input.highlightedFeatureKeys;
    return repository.save(plan);
  }

  async featureState(coffeeShopId: string, feature: SubscriptionFeatureKey, now = new Date(), manager?: EntityManager) {
    const subscription = await (manager ? manager.getRepository(Subscription) : this.dataSource.getRepository(Subscription)).findOne({ where: { coffeeShopId }, relations: { plan: true } });
    if (!subscription) return { enabled: false, status: null, plan: null, feature };
    const effective = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays);
    const enabled = [SubscriptionStatus.Trialing, SubscriptionStatus.Active, SubscriptionStatus.Grace].includes(effective.status) && subscription.plan.features?.[feature] === true;
    return { enabled, status: effective.status, plan: { key: subscription.plan.key, name: subscription.plan.name, features: subscription.plan.features }, feature };
  }

  async requireFeature(coffeeShopId: string, feature: SubscriptionFeatureKey) {
    const state = await this.featureState(coffeeShopId, feature);
    if (!state.enabled) throw new ForbiddenException({ code: "FEATURE_UNAVAILABLE", feature, message: "This feature is not available for the current subscription plan" });
    return state;
  }

  async getPlatformSummary(coffeeShopId: string) {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({ where: { coffeeShopId }, relations: { plan: true, pendingPlan: true } });
    const payments = subscription ? await this.dataSource.getRepository(SubscriptionPayment).find({ where: { subscriptionId: subscription.id }, order: { paidAt: "DESC" }, take: 20 }) : [];
    return { subscription, payments: payments.map((payment) => ({ id: payment.id, status: payment.status, operation: payment.operation, amountToman: payment.amountToman, planKeySnapshot: payment.planKeySnapshot, planNameSnapshot: payment.planNameSnapshot, periodStartedAt: payment.periodStartedAt, periodEndsAt: payment.periodEndsAt, provider: payment.provider, providerReference: payment.providerReference, paidAt: payment.paidAt })) };
  }

  async getTenantSummary(coffeeShopId: string, now = new Date()) {
    await this.reconcileIfNeeded(coffeeShopId, now);
    const subscription = await this.getForTenant(coffeeShopId);
    const end = subscription.status === SubscriptionStatus.Grace ? subscription.graceEndsAt : subscription.paidThroughAt ?? subscription.trialEndsAt;
    return {
      status: subscription.status,
      trialEndsAt: subscription.trialEndsAt,
      currentPeriodStartedAt: subscription.currentPeriodStartedAt,
      currentPeriodEndsAt: subscription.currentPeriodEndsAt,
      paidThroughAt: subscription.paidThroughAt,
      graceEndsAt: subscription.graceEndsAt,
      ...renewalWindow(end, now),
      version: subscription.version,
      pendingChange: subscription.pendingPlan ? { plan: this.planSummary(subscription.pendingPlan), effectiveAt: subscription.pendingPlanEffectiveAt } : null,
      plan: this.planSummary(subscription.plan),
    };
  }

  async listTenantPlans(coffeeShopId: string, now = new Date()) {
    await this.reconcileIfNeeded(coffeeShopId, now);
    const subscription = await this.getForTenant(coffeeShopId);
    const effective = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays).status;
    const plans = await this.dataSource.getRepository(SubscriptionPlan).find({ where: { status: PlanStatus.Active }, order: { sortOrder: "ASC" } });
    return {
      featureCatalog: subscriptionFeatureCatalog,
      trialCard: effective === SubscriptionStatus.Trialing ? { kind: "TRIAL", name: "دوره آزمایشی", active: true, endsAt: subscription.trialEndsAt, features: projectPlanFeatures(subscription.plan.features) } : null,
      plans: plans.map((plan) => ({
        ...this.planSummary(plan),
        highlightedFeatures: projectPlanFeatures(plan.features).filter((feature) => plan.highlightedFeatureKeys.includes(feature.key)),
        features: projectPlanFeatures(plan.features),
        relationship: plan.id === subscription.planId ? "CURRENT" : plan.id === subscription.pendingPlanId ? "PENDING" : "AVAILABLE",
        action: this.actionFor(effective, subscription, plan),
      })),
    };
  }

  async preview(coffeeShopId: string, planKey: string, now = new Date()) { return this.quote(this.dataSource.manager, coffeeShopId, planKey, now); }

  async quote(manager: EntityManager, coffeeShopId: string, planKey: string, now: Date): Promise<SubscriptionQuote> {
    const requestedPlan = await manager.findOneBy(SubscriptionPlan, { key: planKey, status: PlanStatus.Active });
    if (!requestedPlan) throw new ConflictException("Plan is unavailable");
    const subscription = await manager.findOne(Subscription, { where: { coffeeShopId }, relations: { plan: true, pendingPlan: true } });
    if (!subscription) return this.fullPriceQuote(SubscriptionOperation.Purchase, "PURCHASE", requestedPlan, null, null, now);
    const effective = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays).status;
    if (effective === SubscriptionStatus.Canceled) throw new ConflictException("Canceled subscriptions cannot be changed");
    const targetPlan = effective === SubscriptionStatus.Active && requestedPlan.id === subscription.planId && subscription.pendingPlan ? subscription.pendingPlan : requestedPlan;
    if (effective === SubscriptionStatus.Trialing) return this.fullPriceQuote(SubscriptionOperation.TrialToPaid, "TRIAL_TO_PAID", targetPlan, subscription, subscription.plan, now);
    if (effective === SubscriptionStatus.Suspended) return this.fullPriceQuote(SubscriptionOperation.Reactivation, "REACTIVATE", targetPlan, subscription, subscription.plan, now);
    if (effective === SubscriptionStatus.Active && targetPlan.sortOrder < subscription.plan.sortOrder) {
      return { ...this.baseQuote("SCHEDULE_DOWNGRADE", null, targetPlan, subscription, subscription.plan), amountToman: "0", pricing: { sourceCreditToman: "0", targetCostToman: "0", amountDueToman: "0" }, effectiveTiming: "PERIOD_END", periodStartedAt: subscription.paidThroughAt, periodEndsAt: null };
    }
    if (effective === SubscriptionStatus.Active && targetPlan.sortOrder > subscription.plan.sortOrder) {
      const periods = await manager.findBy(SubscriptionPeriod, { subscriptionId: subscription.id, endsAt: MoreThan(now) });
      if (!periods.length) throw new ConflictException("No paid entitlement period is available for upgrade pricing");
      const pricing = periods.reduce((total, period) => {
        const overlapStart = Math.max(now.getTime(), period.startsAt.getTime());
        const overlap = Math.max(0, period.endsAt.getTime() - overlapStart);
        const sourceDuration = period.endsAt.getTime() - period.startsAt.getTime();
        const targetDuration = addUtcMonths(period.startsAt, targetPlan.billingMonths).getTime() - period.startsAt.getTime();
        return {
          source: total.source + prorateToman(period.priceBasisToman, overlap, sourceDuration),
          target: total.target + prorateToman(targetPlan.priceToman, overlap, targetDuration),
        };
      }, { source: 0n, target: 0n });
      const due = pricing.target > pricing.source ? pricing.target - pricing.source : 0n;
      return { ...this.baseQuote("UPGRADE", SubscriptionOperation.Upgrade, targetPlan, subscription, subscription.plan), amountToman: due.toString(), pricing: { sourceCreditToman: pricing.source.toString(), targetCostToman: pricing.target.toString(), amountDueToman: due.toString() }, effectiveTiming: "ON_PAYMENT", periodStartedAt: now, periodEndsAt: subscription.paidThroughAt };
    }
    const periodStartedAt = subscription.paidThroughAt ?? now;
    const periodEndsAt = addUtcMonths(periodStartedAt, targetPlan.billingMonths);
    return { ...this.baseQuote("RENEW", SubscriptionOperation.Renewal, targetPlan, subscription, subscription.plan), amountToman: targetPlan.priceToman, pricing: { sourceCreditToman: "0", targetCostToman: targetPlan.priceToman, amountDueToman: targetPlan.priceToman }, effectiveTiming: "PERIOD_END", periodStartedAt, periodEndsAt };
  }

  async schedulePendingPlan(coffeeShopId: string, planKey: string, expectedVersion: number, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, coffeeShopId); await this.assertNoLiveIntent(manager, coffeeShopId, now);
      const subscription = await manager.findOne(Subscription, { where: { coffeeShopId }, relations: { plan: true } });
      const target = await manager.findOneBy(SubscriptionPlan, { key: planKey, status: PlanStatus.Active });
      if (!subscription || !target) throw new NotFoundException("Subscription plan was not found");
      if (subscription.version !== expectedVersion) throw new ConflictException("Subscription changed; refresh and try again");
      const status = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays).status;
      if (status !== SubscriptionStatus.Active || target.sortOrder >= subscription.plan.sortOrder || !subscription.paidThroughAt) throw new ConflictException("This downgrade is not available");
      subscription.pendingPlanId = target.id; subscription.pendingPlanEffectiveAt = subscription.paidThroughAt; subscription.version += 1;
      await manager.save(subscription);
      return { pendingChange: { plan: this.planSummary(target), effectiveAt: subscription.pendingPlanEffectiveAt }, version: subscription.version };
    });
  }

  async cancelPendingPlan(coffeeShopId: string, expectedVersion?: number, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, coffeeShopId); await this.assertNoLiveIntent(manager, coffeeShopId, now);
      const subscription = await manager.findOneBy(Subscription, { coffeeShopId });
      if (!subscription) throw new NotFoundException("Subscription not found");
      if (expectedVersion != null && subscription.version !== expectedVersion) throw new ConflictException("Subscription changed; refresh and try again");
      subscription.pendingPlanId = null; subscription.pendingPlanEffectiveAt = null; subscription.version += 1;
      await manager.save(subscription); return subscription;
    });
  }

  async applyPaidQuote(manager: EntityManager, coffeeShopId: string, quote: SubscriptionQuote, input: { provider?: string; providerReference?: string; providerAuthority?: string; paymentIntentId?: string; idempotencyKey?: string; recordedByUserId?: string }, now: Date) {
    await this.lock(manager, coffeeShopId);
    const cafe = await manager.findOneBy(CoffeeShop, { id: coffeeShopId });
    if (!cafe) throw new NotFoundException("Coffee shop not found");
    const plan = await manager.findOneByOrFail(SubscriptionPlan, { id: quote.targetPlan.id });
    let subscription = await manager.findOne(Subscription, { where: { coffeeShopId }, relations: { plan: true, pendingPlan: true } });
    if (subscription && quote.subscriptionVersion != null && subscription.version !== quote.subscriptionVersion) throw new ConflictException("Subscription changed after invoice creation");
    if (!subscription) subscription = manager.create(Subscription, { coffeeShopId, planId: plan.id, status: SubscriptionStatus.Active, version: 0 });
    const start = quote.periodStartedAt ?? now;
    const end = quote.periodEndsAt ?? addUtcMonths(start, quote.targetPlan.billingMonths);
    if (quote.operation === SubscriptionOperation.Upgrade) {
      await manager.update(SubscriptionPeriod, { subscriptionId: subscription.id, endsAt: MoreThan(now) }, { planId: plan.id, priceBasisToman: quote.targetPlan.priceToman, billingMonthsBasis: quote.targetPlan.billingMonths });
      subscription.planId = plan.id; subscription.currentPeriodStartedAt = subscription.currentPeriodStartedAt ?? start; subscription.pendingPlanId = null; subscription.pendingPlanEffectiveAt = null;
    } else {
      const duringGrace = subscription.status === SubscriptionStatus.Grace;
      if (quote.operation !== SubscriptionOperation.Renewal || duringGrace || !subscription.currentPeriodStartedAt) {
        subscription.planId = plan.id; subscription.currentPeriodStartedAt = start; subscription.currentPeriodEndsAt = end;
      }
      subscription.paidThroughAt = end;
      if (subscription.pendingPlanId === plan.id && start <= now) { subscription.pendingPlanId = null; subscription.pendingPlanEffectiveAt = null; }
    }
    subscription.status = SubscriptionStatus.Active; subscription.graceEndsAt = null; subscription.suspendedAt = null; subscription.version += 1;
    subscription = await manager.save(subscription);
    const payment = await manager.save(SubscriptionPayment, manager.create(SubscriptionPayment, {
      subscriptionId: subscription.id, status: SubscriptionPaymentStatus.Paid, operation: quote.operation!, amountToman: quote.amountToman,
      pricingSnapshot: quote.pricing, planKeySnapshot: plan.key, planNameSnapshot: plan.name, periodStartedAt: start, periodEndsAt: end,
      provider: input.provider ?? null, providerReference: input.providerReference ?? null, providerAuthority: input.providerAuthority ?? null,
      paymentIntentId: input.paymentIntentId ?? null, recordedByUserId: input.recordedByUserId ?? null, paidAt: now,
      idempotencyKey: input.idempotencyKey ?? null,
    }));
    if (quote.operation !== SubscriptionOperation.Upgrade) await manager.save(SubscriptionPeriod, manager.create(SubscriptionPeriod, { subscriptionId: subscription.id, planId: plan.id, paymentId: payment.id, startsAt: start, endsAt: end, priceBasisToman: quote.targetPlan.priceToman, billingMonthsBasis: quote.targetPlan.billingMonths }));
    cafe.status = CoffeeShopStatus.Active; cafe.suspendedAt = null; if (!cafe.publishedAt) cafe.publishedAt = now; await manager.save(cafe);
    await this.notifications.enqueueOwners(manager, { coffeeShopId, type: NotificationType.SubscriptionActivated, relatedEntityType: "subscription_payment", relatedEntityId: payment.id, deduplicationKey: `${NotificationType.SubscriptionActivated}:${payment.id}`, payload: this.notifications.subscriptionActivatedPayload(cafe.name, plan.name, end, cafe.timezone, quote.operation ?? undefined) });
    return { subscription, payment };
  }

  async recordPrepaidMonth(coffeeShopId: string, input: { planKey?: string; provider?: string; providerReference?: string; idempotencyKey: string; recordedByUserId?: string }, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, coffeeShopId);
      const current = await manager.findOneBy(Subscription, { coffeeShopId });
      if (current && input.idempotencyKey) {
        const existing = await manager.findOneBy(SubscriptionPayment, { subscriptionId: current.id, idempotencyKey: input.idempotencyKey });
        if (existing) return { subscription: current, payment: existing };
      }
      await this.assertNoLiveIntent(manager, coffeeShopId, now);
      const quote = await this.quote(manager, coffeeShopId, input.planKey ?? "silver", now);
      if (!quote.operation || quote.action === "SCHEDULE_DOWNGRADE") throw new ConflictException("This action does not create a payment");
      return this.applyPaidQuote(manager, coffeeShopId, quote, input, now);
    });
  }

  async startTrial(coffeeShopId: string, planKey = "silver", now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, coffeeShopId);
      const cafe = await manager.findOneBy(CoffeeShop, { id: coffeeShopId }); const plan = await manager.findOneBy(SubscriptionPlan, { key: planKey });
      if (!cafe) throw new NotFoundException("Coffee shop not found");
      if (await manager.existsBy(Subscription, { coffeeShopId })) throw new ConflictException("A trial or subscription already exists");
      if (!plan || plan.status !== PlanStatus.Active) throw new ConflictException("The selected plan is not available");
      const subscription = await manager.save(Subscription, manager.create(Subscription, { coffeeShopId, planId: plan.id, status: SubscriptionStatus.Trialing, trialStartedAt: now, trialEndsAt: addDays(now, plan.trialDays), version: 0 }));
      cafe.status = CoffeeShopStatus.Preview; cafe.suspendedAt = null; await manager.save(cafe); return subscription;
    });
  }

  async enforceForPublicRequest(coffeeShopId: string, now = new Date()): Promise<CoffeeShopStatus> {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({ where: { coffeeShopId }, relations: { plan: true } });
    if (!subscription) return CoffeeShopStatus.Suspended;
    const effective = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays);
    const pendingDue = Boolean(subscription.pendingPlanEffectiveAt && now >= subscription.pendingPlanEffectiveAt);
    if (effective.status !== subscription.status || effective.graceEndsAt?.getTime() !== subscription.graceEndsAt?.getTime() || pendingDue) return this.publicCoffeeShopStatus((await this.reconcileTenant(coffeeShopId, now)).status);
    return this.publicCoffeeShopStatus(effective.status);
  }

  async getForTenant(coffeeShopId: string) {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({ where: { coffeeShopId }, relations: { plan: true, pendingPlan: true } });
    if (!subscription) throw new NotFoundException("Subscription not found"); return subscription;
  }

  async reconcileTenant(coffeeShopId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await this.lock(manager, coffeeShopId);
      const subscription = await manager.getRepository(Subscription).createQueryBuilder("subscription").setLock("pessimistic_write").where("subscription.coffee_shop_id = :coffeeShopId", { coffeeShopId }).getOne();
      if (!subscription) throw new NotFoundException("Subscription not found");
      if (subscription.pendingPlanId && subscription.pendingPlanEffectiveAt && now >= subscription.pendingPlanEffectiveAt) { subscription.planId = subscription.pendingPlanId; subscription.pendingPlanId = null; subscription.pendingPlanEffectiveAt = null; subscription.version += 1; }
      const plan = await manager.findOneByOrFail(SubscriptionPlan, { id: subscription.planId });
      const currentPeriod = await manager.getRepository(SubscriptionPeriod).createQueryBuilder("period").where("period.subscription_id=:id", { id: subscription.id }).andWhere("period.starts_at <= :now AND period.ends_at > :now", { now }).orderBy("period.starts_at", "DESC").getOne();
      if (currentPeriod) { subscription.currentPeriodStartedAt = currentPeriod.startsAt; subscription.currentPeriodEndsAt = currentPeriod.endsAt; }
      const next = effectiveSubscriptionStatus(subscription, now, plan.graceDays); subscription.status = next.status; subscription.graceEndsAt = next.graceEndsAt; subscription.suspendedAt = next.status === SubscriptionStatus.Suspended ? (subscription.suspendedAt ?? now) : null; await manager.save(subscription);
      const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId }); cafe.status = this.publicCoffeeShopStatus(next.status); cafe.suspendedAt = cafe.status === CoffeeShopStatus.Suspended ? (cafe.suspendedAt ?? now) : null; await manager.save(cafe); return subscription;
    });
  }

  private async reconcileIfNeeded(coffeeShopId: string, now: Date) {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({ where: { coffeeShopId }, relations: { plan: true } });
    if (!subscription) return;
    const next = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays);
    if (next.status !== subscription.status || next.graceEndsAt?.getTime() !== subscription.graceEndsAt?.getTime() || Boolean(subscription.pendingPlanEffectiveAt && now >= subscription.pendingPlanEffectiveAt)) await this.reconcileTenant(coffeeShopId, now);
  }

  private actionFor(status: SubscriptionStatus, subscription: Subscription, plan: SubscriptionPlan): { type: SubscriptionAction; enabled: boolean } {
    if (status === SubscriptionStatus.Trialing) return { type: "TRIAL_TO_PAID", enabled: true };
    if (status === SubscriptionStatus.Suspended) return { type: "REACTIVATE", enabled: true };
    if (status === SubscriptionStatus.Canceled) return { type: "NONE", enabled: false };
    if (status === SubscriptionStatus.Grace) return { type: "RENEW", enabled: true };
    if (plan.id === subscription.planId) return { type: "RENEW", enabled: true };
    if (plan.sortOrder > subscription.plan.sortOrder) return { type: "UPGRADE", enabled: true };
    return { type: plan.id === subscription.pendingPlanId ? "CHANGE_DOWNGRADE" : "SCHEDULE_DOWNGRADE", enabled: true };
  }

  private planSummary(plan: SubscriptionPlan) { return { id: plan.id, key: plan.key, name: plan.name, description: plan.description, priceToman: plan.priceToman, billingMonths: plan.billingMonths, trialDays: plan.trialDays, graceDays: plan.graceDays, sortOrder: plan.sortOrder, status: plan.status, updatedAt: plan.updatedAt, features: plan.features, highlightedFeatureKeys: plan.highlightedFeatureKeys }; }
  private baseQuote(action: SubscriptionAction, operation: SubscriptionOperation | null, targetPlan: SubscriptionPlan, subscription: Subscription | null, sourcePlan: SubscriptionPlan | null) { return { action, operation, subscriptionVersion: subscription?.version ?? 0, targetPlan: { id: targetPlan.id, key: targetPlan.key, name: targetPlan.name, priceToman: targetPlan.priceToman, billingMonths: targetPlan.billingMonths, updatedAt: targetPlan.updatedAt }, sourcePlan: sourcePlan ? { key: sourcePlan.key, name: sourcePlan.name, priceToman: sourcePlan.priceToman, billingMonths: sourcePlan.billingMonths } : null, currentAccessEndsAt: subscription?.paidThroughAt ?? null } as Omit<SubscriptionQuote, "amountToman" | "pricing" | "effectiveTiming" | "periodStartedAt" | "periodEndsAt">; }
  private fullPriceQuote(operation: SubscriptionOperation, action: SubscriptionAction, plan: SubscriptionPlan, subscription: Subscription | null, sourcePlan: SubscriptionPlan | null, now: Date): SubscriptionQuote { return { ...this.baseQuote(action, operation, plan, subscription, sourcePlan), amountToman: plan.priceToman, pricing: { sourceCreditToman: "0", targetCostToman: plan.priceToman, amountDueToman: plan.priceToman }, effectiveTiming: "ON_PAYMENT", periodStartedAt: null, periodEndsAt: null, currentAccessEndsAt: subscription?.paidThroughAt ?? null }; }
  private publicCoffeeShopStatus(status: SubscriptionStatus) { return status === SubscriptionStatus.Trialing ? CoffeeShopStatus.Preview : status === SubscriptionStatus.Active || status === SubscriptionStatus.Grace ? CoffeeShopStatus.Active : CoffeeShopStatus.Suspended; }
  private async lock(manager: EntityManager, coffeeShopId: string) { await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`subscription:${coffeeShopId}`]); }
  private async assertNoLiveIntent(manager: EntityManager, coffeeShopId: string, now: Date) { const rows = await manager.query(`SELECT 1 FROM payment_intents WHERE coffee_shop_id=$1 AND status IN ('PENDING','VERIFYING') AND expires_at>$2 LIMIT 1`, [coffeeShopId, now]); if (rows.length) throw new ConflictException("A payment is already in progress"); }
}
