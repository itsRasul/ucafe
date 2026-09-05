import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { DataSource, EntityManager, LessThanOrEqual } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { SMS_PROVIDER, SmsProvider } from "../auth/sms-provider";
import { NotificationDelivery, NotificationStatus } from "./entities";

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  constructor(private readonly db: DataSource, private readonly crypto: AuthCryptoService, @Inject(SMS_PROVIDER) private readonly sms: SmsProvider) {}
  onModuleInit() { this.timer = setInterval(() => void this.dispatch(), 5_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async enqueueConfirmation(manager: EntityManager, value: { coffeeShopId: string; reservationId: string; phone: string; cafeName: string; date: string; time: string }) {
    await manager.createQueryBuilder().insert().into(NotificationDelivery).values({ coffeeShopId: value.coffeeShopId, reservationId: value.reservationId, type: "RESERVATION_CONFIRMED", recipientCiphertext: this.crypto.encryptPhone(value.phone), payload: { cafeName: value.cafeName, date: value.date, time: value.time } }).orIgnore().execute();
  }

  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      const repository = this.db.getRepository(NotificationDelivery);
      await repository.createQueryBuilder().update().set({ status: NotificationStatus.Pending }).where("status = :processing AND updated_at < :stale", { processing: NotificationStatus.Processing, stale: new Date(Date.now() - 5 * 60_000) }).execute();
      const jobs = await repository.createQueryBuilder("delivery").addSelect("delivery.recipientCiphertext").where({ status: NotificationStatus.Pending, nextAttemptAt: LessThanOrEqual(new Date()) }).orderBy("delivery.createdAt", "ASC").take(10).getMany();
      for (const job of jobs) {
        const claimed = await repository.update({ id: job.id, status: NotificationStatus.Pending }, { status: NotificationStatus.Processing });
        if (!claimed.affected) continue;
        try {
          const result = await this.sms.sendReservationConfirmation({ phone: this.crypto.decryptPhone(job.recipientCiphertext), ...job.payload });
          await repository.update(job.id, { status: NotificationStatus.Sent, providerMessageId: result.providerMessageId, sentAt: new Date(), lastErrorCode: null });
        } catch {
          const attempts = job.attempts + 1;
          await repository.update(job.id, { attempts, status: attempts >= 3 ? NotificationStatus.Failed : NotificationStatus.Pending, nextAttemptAt: new Date(Date.now() + Math.pow(2, attempts) * 30_000), lastErrorCode: "PROVIDER_UNAVAILABLE" });
          this.logger.warn(`Notification delivery failed id=${job.id} attempt=${attempts}`);
        }
      }
    } finally { this.running = false; }
  }
}
