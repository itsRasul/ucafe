import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { randomInt, randomUUID } from "node:crypto";
import { ValidationPipe } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import source from "../database/data-source";
import { CoffeeShop, CoffeeShopStatus } from "../database/entities";
import { User, UserStatus } from "../identity/entities";
import { PlanStatus, Subscription, SubscriptionPayment, SubscriptionPlan } from "../subscriptions/entities";
import { publicPlanCatalog } from "../subscriptions/public-plan.util";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { TenantsService } from "../tenants/tenants.service";
import { AuthenticationService } from "../auth/authentication.service";
import { OtpPurpose, OtpChallengeStatus } from "../auth/entities";
import { CreateCheckoutDto } from "./dto/payment.dto";
import { PreparePurchaseDto, PurchaseSlugDto } from "./dto/public-purchase.dto";
import { PaymentIntent } from "./entities";
import { PaymentsService } from "./payments.service";
import { PublicPurchaseService } from "./public-purchase.service";
import { SimulatedGateway } from "./simulated.gateway";

test("public catalog exposes active plans and registered boolean entitlements only", () => {
  const plan = (key: string, status: PlanStatus, sortOrder: number) => Object.assign(new SubscriptionPlan(), { id: randomUUID(), key, status, sortOrder, name: key, description: "test", priceToman: "1234567", billingMonths: 3, trialDays: 7, graceDays: 2, features: { menu: true, inventory: false, analytics: "true", secret: "private" }, highlightedFeatureKeys: ["menu", "secret", "inventory"] });
  const result = publicPlanCatalog([plan("later", PlanStatus.Postponed, 1), plan("second", PlanStatus.Active, 3), plan("first", PlanStatus.Active, 2), plan("old", PlanStatus.Archived, 4)]);
  assert.deepEqual(result.plans.map((item) => item.key), ["first", "second"]);
  assert.equal(result.plans[0]!.priceToman, "1234567"); assert.equal(result.plans[0]!.billingMonths, 3);
  assert.equal(result.plans[0]!.features.find((item) => item.key === "analytics")!.included, false);
  assert.deepEqual(result.plans[0]!.highlightedFeatures.map((item) => item.key), ["menu"]);
  assert.deepEqual(result.plans[0]!.displayFeatures, []);
  assert.equal(JSON.stringify(result).includes("private"), false);
  assert.equal("id" in result.plans[0]!, false);
  assert.equal("updatedAt" in result.plans[0]!, false);
});

test("display-only CRM marketing text is public presentation data and does not grant CRM entitlement", async () => {
  const id = randomUUID();
  const plan = Object.assign(new SubscriptionPlan(), { id, key: "bronze", status: PlanStatus.Active, sortOrder: 1, name: "برنزی", description: "", priceToman: "537000", billingMonths: 1, trialDays: 30, graceDays: 7, features: { menu: true, reservations: true, tenant_crm: false }, highlightedFeatureKeys: [] });
  const result = publicPlanCatalog([plan], new Map([[id, [{ key: "display-crm", label: "CRM", value: "دارد", sortOrder: 10 }]]]));
  assert.equal(result.plans[0]!.displayFeatures[0]!.label, "CRM");
  assert.equal(result.plans[0]!.displayFeatures[0]!.value, "دارد");
  assert.equal(result.plans[0]!.features.find((feature) => feature.key === "tenant_crm")!.included, false);
  const subscription = { status: "ACTIVE", plan: { ...plan, updatedAt: new Date(), paidThroughAt: undefined }, trialEndsAt: null, currentPeriodEndsAt: new Date("2026-12-01T00:00:00Z"), paidThroughAt: new Date("2026-12-01T00:00:00Z"), graceEndsAt: null };
  const service = new SubscriptionsService({ getRepository: () => ({ findOne: async () => subscription }) } as never, {} as never);
  assert.equal((await service.featureState("tenant-a", "tenant_crm", new Date("2026-10-01T00:00:00Z"))).enabled, false);
});

test("public DTOs reject browser prices, owner identity, malformed hosts and stale checkout input", async () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const validate = (metatype: typeof PreparePurchaseDto | typeof CreateCheckoutDto | typeof PurchaseSlugDto, value: unknown) => pipe.transform(value, { type: "body", metatype });
  const valid = { name: "کافه نمونه", slug: "sample-cafe", planKey: "silver" };
  await validate(PreparePurchaseDto, valid);
  for (const extra of [{ priceToman: "1" }, { ownerPhone: "09121234567" }, { coffeeShopId: randomUUID() }]) await assert.rejects(validate(PreparePurchaseDto, { ...valid, ...extra }));
  for (const slug of ["a.b", "-cafe", "Cafe", "a".repeat(64), "cafe/../admin"]) await assert.rejects(validate(PurchaseSlugDto, { slug }));
  await assert.rejects(validate(CreateCheckoutDto, { planKey: "silver", idempotencyKey: "a", expectedSubscriptionVersion: -1, expectedPlanUpdatedAt: "bad" }));
});

test("administrative OTP verification rejects a cafe-client challenge before consuming it", async () => {
  let consumed = false;
  const challenge = { id: randomUUID(), purpose: OtpPurpose.ClientLogin, coffeeShopId: randomUUID(), status: OtpChallengeStatus.Pending };
  const builder = { addSelect() { return this; }, setLock() { return this; }, where() { return this; }, async getOne() { return challenge; } };
  const manager = { getRepository: () => ({ createQueryBuilder: () => builder }), save: async () => { consumed = true; } };
  const service = new AuthenticationService({ transaction: async (fn: (m: typeof manager) => unknown) => fn(manager) } as never, {} as never, {} as never, { generateRefreshToken: () => "token" } as never, {} as never, new ConfigService({ OTP_TTL_SECONDS: 120, OTP_RESEND_COOLDOWN_SECONDS: 60, OTP_MAX_ATTEMPTS: 5, ACCESS_TOKEN_TTL_SECONDS: 600, OTP_PHONE_HOURLY_LIMIT: 5, OTP_IP_HOURLY_LIMIT: 20 }), {} as never);
  await assert.rejects(service.verifyOtp(challenge.id, "123456", {})); assert.equal(consumed, false);
});

const integrationUrl = process.env.PUBLIC_PURCHASE_INTEGRATION_DATABASE_URL;
test("PostgreSQL: owner provisioning, price freshness, concurrent purchase, cancellation, failure and exactly-once activation", { skip: !integrationUrl && "Set PUBLIC_PURCHASE_INTEGRATION_DATABASE_URL to run against a migrated development database" }, async () => {
  const db = new DataSource({ type: "postgres", entities: source.options.entities, url: integrationUrl!, synchronize: false, migrationsRun: false });
  const users: string[] = []; const cafeIds: string[] = [];
  await db.initialize();
  const notifications = { enqueueOwners: async () => {}, subscriptionActivatedPayload: () => ({}) };
  const config = new ConfigService({ PLATFORM_BASE_DOMAIN: "u-cafe.localhost", PLATFORM_PUBLIC_URL: "http://localhost:3000", PAYMENT_CALLBACK_BASE_URL: "http://localhost:3001" });
  const gateway = new SimulatedGateway();
  let failVerification = false; let verifies = 0;
  let verificationGate: Promise<void> | undefined; let enteredVerification: (() => void) | undefined;
  const wrappedGateway = { request: gateway.request.bind(gateway), paymentUrl: gateway.paymentUrl.bind(gateway), verify: async (input: Parameters<SimulatedGateway["verify"]>[0]) => { verifies++; if (failVerification) throw new Error("test provider failure"); enteredVerification?.(); await verificationGate; return gateway.verify(input); } };
  const subscriptions = new SubscriptionsService(db, notifications as never);
  const payments = new PaymentsService(db, config, subscriptions, notifications as never, wrappedGateway);
  const service = new PublicPurchaseService(db, config, new TenantsService(db, config), subscriptions, payments);
  async function owner() {
    const user = await db.getRepository(User).save({ phone: `+98912${String(randomInt(0, 10000000)).padStart(7, "0")}`, status: UserStatus.Active, phoneVerifiedAt: new Date() });
    users.push(user.id); return user.id;
  }
  try {
    const userId = await owner(); const wrongUser = await owner();
    const plan = (await db.getRepository(SubscriptionPlan).findBy({ status: PlanStatus.Active }))[0]!; assert.ok(plan);
    const slug = `purchase-${randomUUID().slice(0, 8)}`;
    await assert.rejects(service.prepare(userId, { name: "test", slug, planKey: "invalid-plan" }));
    assert.equal(await db.getRepository(CoffeeShop).existsBy({ slug }), false);
    const [first, second] = await Promise.all([service.prepare(userId, { name: "کافه نمونه", slug, planKey: plan.key }), service.prepare(userId, { name: "کافه نمونه", slug, planKey: plan.key })]);
    assert.equal(first.slug, second.slug);
    const cafe = await db.getRepository(CoffeeShop).findOneByOrFail({ slug }); cafeIds.push(cafe.id);
    assert.equal(cafe.status, CoffeeShopStatus.Draft); assert.equal(await db.getRepository(Subscription).existsBy({ coffeeShopId: cafe.id }), false);
    assert.equal((await service.availability(slug)).available, false);
    await assert.rejects(service.prepare(wrongUser, { name: "test", slug, planKey: plan.key }));
    await assert.rejects(service.prepare(userId, { name: "test", slug: `${slug}-other`, planKey: plan.key }));
    const checkout = { planKey: plan.key, idempotencyKey: randomUUID(), expectedSubscriptionVersion: first.quote.expectedSubscriptionVersion, expectedPlanUpdatedAt: first.quote.expectedPlanUpdatedAt };
    await assert.rejects(service.checkout(userId, slug, { ...checkout, expectedPlanUpdatedAt: "2020-01-01T00:00:00.000Z" }));
    await assert.rejects(service.checkout(wrongUser, slug, checkout));
    const [invoice, duplicateInvoice] = await Promise.all([service.checkout(userId, slug, checkout), service.checkout(userId, slug, checkout)]);
    assert.equal(duplicateInvoice.id, invoice.id);
    assert.equal(invoice.amountToman, plan.priceToman);
    assert.equal((await service.checkout(userId, slug, checkout)).id, invoice.id);
    await assert.rejects(service.invoice(wrongUser, slug, invoice.id));
    await assert.rejects(payments.callback({ intentId: invoice.id, Authority: "wrong-authority", Status: "OK" }));
    const canceled = await payments.callback({ intentId: invoice.id, Authority: invoice.authority!, Status: "NOK" });
    assert.equal(canceled.status, "CANCELED");
    assert.equal((await payments.callback({ intentId: invoice.id, Authority: invoice.authority!, Status: "OK" })).status, "CANCELED");
    assert.equal(await db.getRepository(Subscription).existsBy({ coffeeShopId: cafe.id }), false);
    const failedInvoice = await service.checkout(userId, slug, { ...checkout, idempotencyKey: randomUUID() });
    failVerification = true;
    assert.equal((await payments.callback({ intentId: failedInvoice.id, Authority: failedInvoice.authority!, Status: "OK" })).status, "FAILED");
    assert.equal(await db.getRepository(Subscription).existsBy({ coffeeShopId: cafe.id }), false);
    failVerification = false;
    const expiredInvoice = await service.checkout(userId, slug, { ...checkout, idempotencyKey: randomUUID() });
    await db.getRepository(PaymentIntent).update(expiredInvoice.id, { expiresAt: new Date(Date.now() - 1000) });
    assert.equal((await payments.callback({ intentId: expiredInvoice.id, Authority: expiredInvoice.authority!, Status: "OK" })).status, "EXPIRED");
    const paidInvoice = await service.checkout(userId, slug, { ...checkout, idempotencyKey: randomUUID() });
    let releaseVerification!: () => void;
    verificationGate = new Promise<void>((resolve) => { releaseVerification = resolve; });
    const verificationStarted = new Promise<void>((resolve) => { enteredVerification = resolve; });
    const paying = payments.callback({ intentId: paidInvoice.id, Authority: paidInvoice.authority!, Status: "OK" });
    await verificationStarted;
    assert.equal((await payments.callback({ intentId: paidInvoice.id, Authority: paidInvoice.authority!, Status: "NOK" })).status, "VERIFYING");
    await assert.rejects(service.checkout(userId, slug, { ...checkout, idempotencyKey: randomUUID() }));
    releaseVerification();
    const paid = await paying;
    assert.equal(paid.status, "PAID"); assert.match(paid.redirectUrl, /localhost:3000\/start\/result/);
    assert.equal((await payments.callback({ intentId: paidInvoice.id, Authority: paidInvoice.authority!, Status: "NOK" })).status, "PAID");
    assert.equal((await payments.callback({ intentId: paidInvoice.id, Authority: paidInvoice.authority!, Status: "OK" })).status, "PAID");
    assert.equal(verifies, 2);
    assert.equal(await db.getRepository(SubscriptionPayment).countBy({ paymentIntentId: paidInvoice.id }), 1);
    assert.equal((await db.getRepository(CoffeeShop).findOneByOrFail({ id: cafe.id })).status, CoffeeShopStatus.Active);
    assert.equal((await service.invoice(userId, slug, paidInvoice.id)).status, "PAID");
    assert.equal((await service.checkout(userId, slug, { ...checkout, idempotencyKey: (await db.getRepository(PaymentIntent).findOneByOrFail({ id: paidInvoice.id })).idempotencyKey })).id, paidInvoice.id);
  } finally {
    try {
      await db.transaction(async (manager) => {
        for (const id of cafeIds) {
          await manager.query("DELETE FROM subscription_periods WHERE subscription_id IN (SELECT id FROM subscriptions WHERE coffee_shop_id=$1)", [id]);
          await manager.query("DELETE FROM subscription_payments WHERE subscription_id IN (SELECT id FROM subscriptions WHERE coffee_shop_id=$1)", [id]);
          await manager.query("DELETE FROM subscriptions WHERE coffee_shop_id=$1", [id]);
          await manager.query("DELETE FROM domains WHERE coffee_shop_id=$1", [id]);
          await manager.query("DELETE FROM branches WHERE coffee_shop_id=$1", [id]);
          await manager.query("DELETE FROM coffee_shop_memberships WHERE coffee_shop_id=$1", [id]);
          await manager.query("DELETE FROM coffee_shops WHERE id=$1", [id]);
        }
        for (const id of users) await manager.query("DELETE FROM users WHERE id=$1", [id]);
      });
    } finally { await db.destroy(); }
  }
});
