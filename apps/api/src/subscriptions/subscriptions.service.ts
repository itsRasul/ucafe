import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { CoffeeShop, CoffeeShopStatus } from "../database/entities";
import { PlanStatus, Subscription, SubscriptionPayment, SubscriptionPaymentStatus, SubscriptionPlan, SubscriptionStatus } from "./entities";
import { addDays, addUtcMonths, effectiveSubscriptionStatus } from "./subscription-lifecycle";
import { UpdatePlanDto } from "./dto/update-plan.dto";

@Injectable()
export class SubscriptionsService {
  constructor(private readonly dataSource: DataSource) {}

  async listPlans() { return this.dataSource.getRepository(SubscriptionPlan).find({ order: { priceToman: "ASC" } }); }

  async updatePlan(planKey: string, input: UpdatePlanDto) {
    const repository = this.dataSource.getRepository(SubscriptionPlan);
    const plan = await repository.findOneBy({ key: planKey });
    if (!plan) throw new NotFoundException("Subscription plan not found");
    if (input.name != null) plan.name = input.name.trim();
    if (input.priceToman != null) plan.priceToman = input.priceToman.toString();
    if (input.status != null) plan.status = input.status;
    if (input.trialDays != null) plan.trialDays = input.trialDays;
    if (input.graceDays != null) plan.graceDays = input.graceDays;
    return repository.save(plan);
  }

  async getPlatformSummary(coffeeShopId: string) {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({ where: { coffeeShopId }, relations: { plan: true } });
    const payments = subscription ? await this.dataSource.getRepository(SubscriptionPayment).find({ where: { subscriptionId: subscription.id }, order: { paidAt: "DESC" }, take: 20 }) : [];
    return { subscription, payments: payments.map((payment) => ({ id: payment.id, status: payment.status, amountToman: payment.amountToman, planKeySnapshot: payment.planKeySnapshot, planNameSnapshot: payment.planNameSnapshot, periodStartedAt: payment.periodStartedAt, periodEndsAt: payment.periodEndsAt, provider: payment.provider, providerReference: payment.providerReference, paidAt: payment.paidAt })) };
  }

  async enforceForPublicRequest(coffeeShopId: string, now = new Date()): Promise<CoffeeShopStatus> {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({
      where: { coffeeShopId },
      relations: { plan: true },
    });
    if (!subscription) return CoffeeShopStatus.Suspended;

    const effective = effectiveSubscriptionStatus(subscription, now, subscription.plan.graceDays);
    const graceChanged = effective.graceEndsAt?.getTime() !== subscription.graceEndsAt?.getTime();
    if (effective.status !== subscription.status || graceChanged) {
      const reconciled = await this.reconcileTenant(coffeeShopId, now);
      return this.publicCoffeeShopStatus(reconciled.status);
    }
    return this.publicCoffeeShopStatus(effective.status);
  }

  private publicCoffeeShopStatus(status: SubscriptionStatus): CoffeeShopStatus {
    if (status === SubscriptionStatus.Trialing) return CoffeeShopStatus.Preview;
    if (status === SubscriptionStatus.Active || status === SubscriptionStatus.Grace) return CoffeeShopStatus.Active;
    return CoffeeShopStatus.Suspended;
  }
  async getForTenant(coffeeShopId: string) {
    const subscription = await this.dataSource.getRepository(Subscription).findOne({
      where: { coffeeShopId },
      relations: { plan: true },
    });
    if (!subscription) throw new NotFoundException("Subscription not found");
    return subscription;
  }

  async startTrial(coffeeShopId: string, planKey = "silver", now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`subscription:${coffeeShopId}`]);
      const coffeeShop = await manager.findOneBy(CoffeeShop, { id: coffeeShopId });
      if (!coffeeShop) throw new NotFoundException("Coffee shop not found");
      if (await manager.existsBy(Subscription, { coffeeShopId })) throw new ConflictException("A trial or subscription already exists");
      const plan = await manager.findOneBy(SubscriptionPlan, { key: planKey });
      if (!plan || plan.status !== PlanStatus.Active) throw new ConflictException("The selected plan is not available");

      const subscription = await manager.save(Subscription, manager.create(Subscription, {
        coffeeShopId,
        planId: plan.id,
        status: SubscriptionStatus.Trialing,
        trialStartedAt: now,
        trialEndsAt: addDays(now, plan.trialDays),
      }));
      coffeeShop.status = CoffeeShopStatus.Preview;
      coffeeShop.suspendedAt = null;
      await manager.save(coffeeShop);
      return subscription;
    });
  }

  async recordPrepaidMonth(coffeeShopId: string, input: { planKey?: string; provider?: string; providerReference?: string; recordedByUserId?: string }, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`subscription:${coffeeShopId}`]);
      const coffeeShop = await manager.findOneBy(CoffeeShop, { id: coffeeShopId });
      if (!coffeeShop) throw new NotFoundException("Coffee shop not found");
      const plan = await manager.findOneBy(SubscriptionPlan, { key: input.planKey ?? "silver" });
      if (!plan || plan.status !== PlanStatus.Active) throw new ConflictException("The selected plan is not available");

      let subscription = await manager.findOneBy(Subscription, { coffeeShopId });
      if (!subscription) {
        subscription = manager.create(Subscription, { coffeeShopId, planId: plan.id, status: SubscriptionStatus.Active });
      }
      const candidates = [now, subscription.currentPeriodEndsAt, subscription.status === SubscriptionStatus.Trialing ? subscription.trialEndsAt : null]
        .filter((value): value is Date => Boolean(value));
      const periodStartedAt = new Date(Math.max(...candidates.map((value) => value.getTime())));
      const periodEndsAt = addUtcMonths(periodStartedAt, plan.billingMonths);

      subscription.planId = plan.id;
      subscription.status = SubscriptionStatus.Active;
      subscription.currentPeriodStartedAt = periodStartedAt;
      subscription.currentPeriodEndsAt = periodEndsAt;
      subscription.graceEndsAt = null;
      subscription.suspendedAt = null;
      subscription = await manager.save(subscription);

      const payment = await manager.save(SubscriptionPayment, manager.create(SubscriptionPayment, {
        subscriptionId: subscription.id,
        status: SubscriptionPaymentStatus.Paid,
        amountToman: plan.priceToman,
        planKeySnapshot: plan.key,
        planNameSnapshot: plan.name,
        periodStartedAt,
        periodEndsAt,
        provider: input.provider ?? null,
        providerReference: input.providerReference ?? null,
        recordedByUserId: input.recordedByUserId ?? null,
        paidAt: now,
      }));

      coffeeShop.status = CoffeeShopStatus.Active;
      coffeeShop.suspendedAt = null;
      if (!coffeeShop.publishedAt) coffeeShop.publishedAt = now;
      await manager.save(coffeeShop);
      return { subscription, payment };
    });
  }

  async reconcileTenant(coffeeShopId: string, now = new Date()) {
    return this.dataSource.transaction(async (manager) => {
      const subscription = await manager.getRepository(Subscription).createQueryBuilder("subscription")
        .setLock("pessimistic_write").where("subscription.coffee_shop_id = :coffeeShopId", { coffeeShopId }).getOne();
      if (!subscription) throw new NotFoundException("Subscription not found");
      const plan = await manager.findOneByOrFail(SubscriptionPlan, { id: subscription.planId });
      const next = effectiveSubscriptionStatus(subscription, now, plan.graceDays);
      subscription.status = next.status;
      subscription.graceEndsAt = next.graceEndsAt;
      subscription.suspendedAt = next.status === SubscriptionStatus.Suspended ? (subscription.suspendedAt ?? now) : null;
      await manager.save(subscription);

      const coffeeShop = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
      if (next.status === SubscriptionStatus.Suspended || next.status === SubscriptionStatus.Canceled) {
        coffeeShop.status = CoffeeShopStatus.Suspended;
        coffeeShop.suspendedAt = coffeeShop.suspendedAt ?? now;
      } else if (next.status === SubscriptionStatus.Active || next.status === SubscriptionStatus.Grace) {
        coffeeShop.status = CoffeeShopStatus.Active;
        coffeeShop.suspendedAt = null;
      } else {
        coffeeShop.status = CoffeeShopStatus.Preview;
        coffeeShop.suspendedAt = null;
      }
      await manager.save(coffeeShop);
      return subscription;
    });
  }
}
