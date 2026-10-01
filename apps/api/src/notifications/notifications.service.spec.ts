import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { DataSource } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { NotificationDelivery, NotificationStatus } from "./entities";
import { NotificationType } from "./notification-type";
import { NotificationsService } from "./notifications.service";

test("provider failure retries one recipient and dispatch continues for other recipients", async () => {
  const config = new ConfigService({ AUTH_PEPPER: "test-only-auth-pepper-with-at-least-32-characters", PII_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"), SMS_PROVIDER: "development", SUPPORT_TICKET_CREATED: "" });
  const crypto = new AuthCryptoService(config);
  const updates: Array<Record<string, unknown>> = [];
  const job = {
    id: "delivery-id", coffeeShopId: "tenant-id", type: NotificationType.TicketCreated,
    relatedEntityType: "support_ticket", relatedEntityId: "ticket-id", deduplicationKey: "ticket:event:recipient",
    recipientCiphertext: crypto.encryptPhone("+989120000001"), payload: { ticketReference: "UC-123" },
    status: NotificationStatus.Pending, attempts: 0, nextAttemptAt: new Date(),
  } as unknown as NotificationDelivery;
  const nextJob = { ...job, id: "delivery-id-2", recipientCiphertext: crypto.encryptPhone("+989120000002"), deduplicationKey: "ticket:event:recipient-2" };
  const repository = {
    createQueryBuilder(alias?: string) {
      const builder: Record<string, (...args: unknown[]) => unknown> = {};
      for (const method of ["update", "set", "where", "addSelect", "orderBy", "take"]) builder[method] = () => builder;
      builder.execute = async () => ({ affected: 0 });
      builder.getMany = async () => alias ? [job, nextJob] : [];
      return builder;
    },
    update: async (_criteria: unknown, values: Record<string, unknown>) => { updates.push(values); return { affected: 1 }; },
  };
  const db = { getRepository: () => repository } as unknown as DataSource;
  const sentPhones: string[] = [];
  const sms = { sendTemplate: async (message: { phone: string }) => {
    sentPhones.push(message.phone);
    if (message.phone === "+989120000001") throw Object.assign(new Error("simulated sms.ir failure"), { providerCode: "SMSIR_HTTP_503" });
    return { providerMessageId: "provider-message-2" };
  } };
  const service = new NotificationsService(db, crypto, config, sms as never);
  (service as unknown as { lastScheduledSweep: number }).lastScheduledSweep = Date.now();

  await service.dispatch();

  assert.deepEqual(sentPhones, ["+989120000001", "+989120000002"]);
  const retry = updates.find((update) => update.lastErrorCode === "SMSIR_HTTP_503");
  const sent = updates.find((update) => update.providerMessageId === "provider-message-2");
  assert.equal(retry?.attempts, 1);
  assert.equal(retry?.status, NotificationStatus.Pending);
  assert.ok(retry?.nextAttemptAt instanceof Date);
  assert.equal(sent?.status, NotificationStatus.Sent);
});
