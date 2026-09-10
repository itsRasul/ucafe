import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { OtpChallenge, OtpChallengeStatus, OtpPurpose } from "../auth/entities";
import { ClientAuthService } from "./client-auth.service";
import { Client, ClientAuthSession, ClientStatus } from "./entities";

function createHarness() {
  const config = new ConfigService({
    AUTH_PEPPER: "client-auth-test-pepper",
    PII_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
    OTP_TTL_SECONDS: 300,
    OTP_RESEND_COOLDOWN_SECONDS: 60,
    OTP_MAX_ATTEMPTS: 5,
    ACCESS_TOKEN_TTL_SECONDS: 900,
    OTP_PHONE_HOURLY_LIMIT: 5,
    OTP_IP_HOURLY_LIMIT: 20,
  });
  const crypto = new AuthCryptoService(config);
  const clients: Client[] = [];
  let activeChallenge: OtpChallenge;

  const manager = {
    getRepository: (entity: unknown) => {
      assert.equal(entity, OtpChallenge);
      const builder = {
        addSelect: () => builder,
        setLock: () => builder,
        where: () => builder,
        getOne: async () => activeChallenge,
      };
      return { createQueryBuilder: () => builder };
    },
    findOneBy: async (entity: unknown, where: { coffeeShopId: string; phone: string }) => {
      assert.equal(entity, Client);
      return clients.find((client) => client.coffeeShopId === where.coffeeShopId && client.phone === where.phone) ?? null;
    },
    create: (entity: unknown, value: object) => Object.assign(entity === Client ? new Client() : new ClientAuthSession(), value),
    save: async (typeOrEntity: unknown, value?: unknown) => {
      const entity = (value ?? typeOrEntity) as Client | ClientAuthSession | OtpChallenge;
      if (entity instanceof Client) {
        if (!entity.id) entity.id = `client-${clients.length + 1}`;
        if (!clients.includes(entity)) clients.push(entity);
      }
      return entity;
    },
  };
  const dataSource = { transaction: async (work: (value: typeof manager) => Promise<unknown>) => work(manager) };
  const tokens = {
    issueClientAccessToken: async (clientId: string, _sessionId: string, coffeeShopId: string) => `access:${coffeeShopId}:${clientId}`,
    refreshTokenExpiresAt: (now: Date) => new Date(now.getTime() + 86_400_000),
  };
  const service = new ClientAuthService(dataSource as never, {} as never, {} as never, crypto, tokens as never, config, { sendOtp: async () => ({ providerMessageId: "test" }) } as never);

  function challenge(coffeeShopId: string, phone: string, otp = "123456") {
    const id = `challenge-${coffeeShopId}-${clients.length}`;
    activeChallenge = Object.assign(new OtpChallenge(), {
      id,
      coffeeShopId,
      phoneHash: crypto.hashPhone(phone),
      phoneCiphertext: crypto.encryptPhone(phone),
      otpHash: crypto.hashOtp(id, otp),
      purpose: OtpPurpose.ClientLogin,
      status: OtpChallengeStatus.Pending,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: new Date(Date.now() + 60_000),
      resendAvailableAt: new Date(),
      consumedAt: null,
    });
    return { id, otp };
  }

  return { service, clients, challenge };
}

test("client OTP registers once, then logs in without names and remains tenant scoped", async () => {
  const { service, clients, challenge } = createHarness();
  const first = challenge("cafe-a", "+989121234567");
  const registration = await service.verifyOtp("cafe-a", first.id, first.otp, {}, { firstName: "سارا", lastName: "احمدی" });
  assert.equal(registration.client.firstName, "سارا");
  assert.equal(clients.length, 1);

  const second = challenge("cafe-a", "+989121234567");
  const login = await service.verifyOtp("cafe-a", second.id, second.otp, {});
  assert.equal(login.client.id, registration.client.id);
  assert.equal(clients.length, 1);

  const otherTenant = challenge("cafe-b", "+989121234567");
  const secondRegistration = await service.verifyOtp("cafe-b", otherTenant.id, otherTenant.otp, {}, { firstName: "سارا", lastName: "احمدی" });
  assert.notEqual(secondRegistration.client.id, registration.client.id);
  assert.equal(clients.length, 2);
  assert.deepEqual(clients.map((client) => client.status), [ClientStatus.Active, ClientStatus.Active]);
});
