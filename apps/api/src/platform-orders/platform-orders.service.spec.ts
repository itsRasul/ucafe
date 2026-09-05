import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { HttpException } from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import type { Repository } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import type { PlatformOrderRequest } from "./entities";
import { PlatformOrderBusinessStage, PlatformOrderService, PlatformOrderStatus } from "./entities";
import type { SubscriptionPlan } from "../subscriptions/entities";
import { PlanStatus } from "../subscriptions/entities";
import { CreatePlatformOrderRequestDto } from "./dto/create-platform-order-request.dto";
import { PlatformOrdersService } from "./platform-orders.service";

const crypto = new AuthCryptoService({ getOrThrow(key: string) { return key === "PII_ENCRYPTION_KEY" ? Buffer.alloc(32, 7).toString("base64") : "p".repeat(32); } } as never);
const validInput = { contactName: "آرمان رضایی", coffeeShopName: "کافه آبی", phone: "۰۹۱۲۱۲۳۴۵۶۷", city: "تهران", businessStage: PlatformOrderBusinessStage.Operating, requestedServices: [PlatformOrderService.Website, PlatformOrderService.OnlineMenu], note: "نسخه اولیه" };

function createService(options: { recent?: boolean } = {}) {
  const saved: PlatformOrderRequest[] = [];
  const requestRepository = {
    existsBy: async () => options.recent ?? false,
    create: (value: PlatformOrderRequest) => value,
    save: async (value: PlatformOrderRequest) => {
      const result = { ...value, id: "8b332415-73c4-4dc5-b45f-3a65ca0bb5e2", createdAt: new Date("2026-09-03T10:00:00Z"), updatedAt: new Date("2026-09-03T10:00:00Z") } as PlatformOrderRequest;
      saved.push(result); return result;
    },
  } as unknown as Repository<PlatformOrderRequest>;
  const planRepository = { findOneBy: async () => ({ key: "silver", name: "نقره‌ای", status: PlanStatus.Active, priceToman: "1900000", billingMonths: 1, trialDays: 7 }) } as unknown as Repository<SubscriptionPlan>;
  return { service: new PlatformOrdersService(requestRepository, planRepository, crypto), saved };
}

test("platform order DTO rejects unknown services and empty service lists", async () => {
  const unknown = plainToInstance(CreatePlatformOrderRequestDto, { ...validInput, requestedServices: ["UNKNOWN"] });
  const empty = plainToInstance(CreatePlatformOrderRequestDto, { ...validInput, requestedServices: [] });
  assert.ok((await validate(unknown)).some((error) => error.property === "requestedServices"));
  assert.ok((await validate(empty)).some((error) => error.property === "requestedServices"));
});

test("creates an encrypted platform request without returning the phone", async () => {
  const { service, saved } = createService();
  const result = await service.create(validInput);
  assert.equal(result.status, PlatformOrderStatus.New);
  assert.equal("phone" in result, false);
  assert.equal(saved.length, 1);
  const persisted = saved[0];
  assert.ok(persisted);
  assert.notEqual(persisted.phoneEncrypted, "+989121234567");
  assert.equal(crypto.decryptPhone(persisted.phoneEncrypted), "+989121234567");
  assert.match(persisted.phoneHash, /^[a-f0-9]{64}$/);
});

test("rejects a repeated phone during the duplicate window", async () => {
  const { service } = createService({ recent: true });
  await assert.rejects(() => service.create(validInput), (error: unknown) => error instanceof HttpException && error.getStatus() === 429);
});

test("honeypot submissions return a neutral response without persistence", async () => {
  const { service, saved } = createService();
  const result = await service.create({ ...validInput, website: "https://spam.example" });
  assert.equal(result.status, PlatformOrderStatus.New);
  assert.equal(saved.length, 0);
});

test("public offering exposes only the active silver commercial fields", async () => {
  const { service } = createService();
  assert.deepEqual(await service.getPublicOffering(), { key: "silver", name: "نقره‌ای", priceToman: "1900000", billingMonths: 1, trialDays: 7 });
});
