import { BadGatewayException, ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, LessThan } from "typeorm";
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
      if (existing) return this.project(existing, existing.authority ? this.gateway.paymentUrl(existing.authority, this.callbackUrl(existing.id)) : undefined);
      const plan = await manager.findOneBy(SubscriptionPlan, { key: input.planKey, status: PlanStatus.Active });
      if (!plan) throw new ConflictException("Plan is unavailable");
      let intent = await repository.save(repository.create({ coffeeShopId, planId: plan.id, planKeySnapshot: plan.key, planNameSnapshot: plan.name, amountToman: plan.priceToman, provider: "ZARINPAL", idempotencyKey: input.idempotencyKey, status: PaymentIntentStatus.Pending, expiresAt: new Date(Date.now() + 15 * 60_000) }));
      const requested = await this.gateway.request({ amountRial: this.toRial(intent.amountToman), callbackUrl: this.callbackUrl(intent.id), description: `اشتراک ${plan.name} کافکسا` });
      intent.authority = requested.authority;
      intent = await repository.save(intent);
      return this.project(intent, requested.paymentUrl);
    });
  }

  async callback(input: PaymentCallbackDto) {
    const repository = this.db.getRepository(PaymentIntent);
    const intent = await repository.findOneBy({ id: input.intentId, authority: input.Authority });
    if (!intent) throw new NotFoundException("Payment was not found");
    if (intent.status === PaymentIntentStatus.Paid) return this.project(intent);
    if (input.Status !== "OK") { intent.status = PaymentIntentStatus.Failed; return this.project(await repository.save(intent)); }
    if (intent.expiresAt <= new Date()) { intent.status = PaymentIntentStatus.Expired; await repository.save(intent); throw new ConflictException("Payment request expired"); }
    const prior = await this.db.getRepository(SubscriptionPayment).findOneBy({ provider: "ZARINPAL", providerReference: input.Authority });
    if (prior) { intent.status = PaymentIntentStatus.Paid; intent.paidAt = prior.paidAt; return this.project(await repository.save(intent)); }
    if (intent.status === PaymentIntentStatus.Verifying) {
      await repository.update({ id: intent.id, status: PaymentIntentStatus.Verifying, updatedAt: LessThan(new Date(Date.now() - 5 * 60_000)) }, { status: PaymentIntentStatus.Pending });
    }
    const claim = await repository.update({ id: intent.id, status: PaymentIntentStatus.Pending }, { status: PaymentIntentStatus.Verifying });
    if (!claim.affected) throw new ConflictException("Payment verification is already in progress");
    try {
      const verified = await this.gateway.verify({ authority: input.Authority, amountRial: this.toRial(intent.amountToman) });
      const result = await this.subscriptions.recordPrepaidMonth(intent.coffeeShopId, { planKey: intent.planKeySnapshot, provider: "ZARINPAL", providerReference: input.Authority });
      intent.status = PaymentIntentStatus.Paid; intent.providerReference = verified.reference; intent.paidAt = result.payment.paidAt;
      return this.project(await repository.save(intent));
    } catch (error) {
      await repository.update(intent.id, { status: PaymentIntentStatus.Pending });
      if (error instanceof BadGatewayException) throw error;
      throw new BadGatewayException("Payment verification failed");
    }
  }

  private toRial(amountToman: string) { const amount = Number(amountToman); if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isSafeInteger(amount * 10)) throw new ConflictException("Payment amount is invalid"); return amount * 10; }
  private callbackUrl(intentId: string) { const base = this.config.getOrThrow<string>("PAYMENT_CALLBACK_BASE_URL").replace(/\/$/, ""); return `${base}/api/v1/public/payments/callback?intentId=${intentId}`; }
  private project(intent: PaymentIntent, paymentUrl?: string) { return { id: intent.id, status: intent.status, amountToman: intent.amountToman, plan: { key: intent.planKeySnapshot, name: intent.planNameSnapshot }, authority: intent.authority, providerReference: intent.providerReference, expiresAt: intent.expiresAt, paidAt: intent.paidAt, ...(paymentUrl ? { paymentUrl } : {}) }; }
}
