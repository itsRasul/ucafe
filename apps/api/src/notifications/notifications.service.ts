import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { DataSource, EntityManager, LessThanOrEqual } from "typeorm";
import { AuthCryptoService } from "../auth/auth-crypto.service";
import { normalizeIranianMobile } from "../auth/iran-phone.util";
import { SMS_PROVIDER, SmsProvider } from "../auth/sms-provider";
import { NotificationDelivery, NotificationStatus } from "./entities";
import { jalaliDate, NotificationPayload, NotificationType } from "./notification-type";

type EnqueueInput = {
  coffeeShopId: string;
  type: NotificationType;
  relatedEntityType: string;
  relatedEntityId: string;
  deduplicationKey: string;
  phone: string;
  payload: NotificationPayload;
};

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;
  private lastScheduledSweep = 0;

  constructor(
    private readonly db: DataSource,
    private readonly crypto: AuthCryptoService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {}

  onModuleInit() { this.timer = setInterval(() => void this.dispatch(), 5_000); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async enqueue(manager: EntityManager, value: EnqueueInput) {
    try {
      const phone = normalizeIranianMobile(value.phone);
      await manager.createQueryBuilder().insert().into(NotificationDelivery).values({
        ...value,
        reservationId: value.relatedEntityType === "reservation" ? value.relatedEntityId : null,
        recipientCiphertext: this.crypto.encryptPhone(phone),
      }).orIgnore().execute();
    } catch {
      this.logger.warn(`Notification enqueue skipped type=${value.type} tenant=${value.coffeeShopId} entity=${value.relatedEntityType}:${value.relatedEntityId}`);
    }
  }

  async enqueueOwners(manager: EntityManager, value: Omit<EnqueueInput, "phone">) {
    const owners = await manager.query<Array<{ userId: string; phone: string }>>(
      `SELECT DISTINCT u.id AS "userId", u.phone
       FROM coffee_shop_memberships m
       JOIN membership_roles mr ON mr.membership_id=m.id
       JOIN roles r ON r.id=mr.role_id AND r.scope='TENANT' AND r.key='owner'
       JOIN users u ON u.id=m.user_id AND u.status='ACTIVE' AND u.deleted_at IS NULL
       WHERE m.coffee_shop_id=$1 AND m.status='ACTIVE' AND u.phone IS NOT NULL`,
      [value.coffeeShopId],
    );
    for (const owner of owners) await this.enqueue(manager, { ...value, phone: owner.phone, deduplicationKey: `${value.deduplicationKey}:${owner.userId}` });
  }

  async dispatch() {
    if (this.running) return;
    this.running = true;
    try {
      if (Date.now() - this.lastScheduledSweep >= 60_000) {
        this.lastScheduledSweep = Date.now();
        await this.enqueueScheduled();
      }
      const repository = this.db.getRepository(NotificationDelivery);
      await repository.createQueryBuilder().update().set({ status: NotificationStatus.Pending }).where("status = :processing AND updated_at < :stale", { processing: NotificationStatus.Processing, stale: new Date(Date.now() - 5 * 60_000) }).execute();
      const jobs = await repository.createQueryBuilder("delivery").addSelect("delivery.recipientCiphertext").where({ status: NotificationStatus.Pending, nextAttemptAt: LessThanOrEqual(new Date()) }).orderBy("delivery.createdAt", "ASC").take(10).getMany();
      for (const job of jobs) {
        const claimed = await repository.update({ id: job.id, status: NotificationStatus.Pending }, { status: NotificationStatus.Processing });
        if (!claimed.affected) continue;
        try {
          if (!await this.isStillEligible(job)) {
            await repository.update(job.id, { status: NotificationStatus.Sent, sentAt: new Date(), lastErrorCode: "NO_LONGER_ELIGIBLE" });
            continue;
          }
          const templateId = Number(this.config.get<string>(job.type) ?? (this.config.get("SMS_PROVIDER") === "development" ? "1" : ""));
          if (!Number.isSafeInteger(templateId) || templateId <= 0) throw new Error("SMS template is not configured");
          const result = await this.sms.sendTemplate({ phone: this.crypto.decryptPhone(job.recipientCiphertext), templateId, parameters: Object.entries(job.payload).map(([name, value]) => ({ name, value })) });
          await repository.update(job.id, { status: NotificationStatus.Sent, providerMessageId: result.providerMessageId, sentAt: new Date(), lastErrorCode: null });
          this.logger.log(`Notification sent type=${job.type} tenant=${job.coffeeShopId} entity=${job.relatedEntityType}:${job.relatedEntityId}`);
        } catch {
          const attempts = job.attempts + 1;
          await repository.update(job.id, { attempts, status: attempts >= 3 ? NotificationStatus.Failed : NotificationStatus.Pending, nextAttemptAt: new Date(Date.now() + Math.pow(2, attempts) * 30_000), lastErrorCode: "PROVIDER_UNAVAILABLE" });
          this.logger.warn(`Notification delivery failed id=${job.id} type=${job.type} attempt=${attempts}`);
        }
      }
    } finally { this.running = false; }
  }

  private async isStillEligible(job: NotificationDelivery) {
    if (job.type === NotificationType.ReservationReminder) {
      const rows = await this.db.query<Array<{ eligible: boolean }>>(
        `SELECT EXISTS(SELECT 1 FROM reservations r JOIN branches b ON b.id=r.branch_id WHERE r.id=$1 AND r.coffee_shop_id=$2 AND r.status='CONFIRMED' AND ((r.reservation_date+r.start_time) AT TIME ZONE b.timezone)>now()) AS eligible`,
        [job.relatedEntityId, job.coffeeShopId],
      );
      return rows[0]?.eligible === true;
    }
    if ([NotificationType.SubscriptionExpires3Days, NotificationType.SubscriptionExpires2Days, NotificationType.SubscriptionExpires1Day, NotificationType.SubscriptionExpiresToday, NotificationType.SubscriptionExpired, NotificationType.SubscriptionExpiredFollowUp].includes(job.type)) {
      const rows = await this.db.query<Array<{ currentPeriodEndsAt: Date | null }>>(`SELECT current_period_ends_at AS "currentPeriodEndsAt" FROM subscriptions WHERE id=$1 AND coffee_shop_id=$2 AND status<>'CANCELED'`, [job.relatedEntityId, job.coffeeShopId]);
      const current = rows[0]?.currentPeriodEndsAt;
      return Boolean(current && job.deduplicationKey.includes(current.toISOString()));
    }
    return true;
  }

  private async enqueueScheduled(now = new Date()) {
    await this.db.transaction(async (manager) => {
      const reservations = await manager.query<Array<{ id:string; coffeeShopId:string; phone:string; customerName:string; cafeName:string; reservationDate:string; startTime:string; partySize:number }>>(
        `SELECT r.id, r.coffee_shop_id AS "coffeeShopId", c.phone, r.contact_name AS "customerName", cs.name AS "cafeName",
                r.reservation_date::text AS "reservationDate", r.start_time::text AS "startTime", r.party_size AS "partySize"
         FROM reservations r
         JOIN clients c ON c.id=r.client_id AND c.coffee_shop_id=r.coffee_shop_id
         JOIN coffee_shops cs ON cs.id=r.coffee_shop_id
         JOIN branches b ON b.id=r.branch_id AND b.coffee_shop_id=r.coffee_shop_id
         JOIN reservation_settings s ON s.branch_id=r.branch_id
         WHERE r.status='CONFIRMED'
           AND ((r.reservation_date + r.start_time) AT TIME ZONE b.timezone) > $1
           AND ((r.reservation_date + r.start_time) AT TIME ZONE b.timezone) - make_interval(hours => s.reminder_hours) <= $1`,
        [now],
      );
      for (const row of reservations) await this.enqueue(manager, {
        coffeeShopId: row.coffeeShopId, type: NotificationType.ReservationReminder, relatedEntityType: "reservation", relatedEntityId: row.id,
        deduplicationKey: `${NotificationType.ReservationReminder}:${row.id}`, phone: row.phone,
        payload: { customerName: row.customerName, cafeName: row.cafeName, time: row.startTime.slice(0, 5), guestCount: String(row.partySize) },
      });

      const subscriptions = await manager.query<Array<{ id:string; coffeeShopId:string; cafeName:string; timezone:string; planName:string; currentPeriodEndsAt:Date; graceDays:number; graceEndsAt:Date|null }>>(
        `SELECT s.id, s.coffee_shop_id AS "coffeeShopId", c.name AS "cafeName", c.timezone, p.name AS "planName",
                s.current_period_ends_at AS "currentPeriodEndsAt", p.grace_days AS "graceDays", s.grace_ends_at AS "graceEndsAt"
         FROM subscriptions s JOIN coffee_shops c ON c.id=s.coffee_shop_id JOIN subscription_plans p ON p.id=s.plan_id
         WHERE s.current_period_ends_at IS NOT NULL AND s.status <> 'CANCELED'`,
      );
      for (const row of subscriptions) await this.enqueueSubscriptionSchedule(manager, row, now);
    });
  }

  private async enqueueSubscriptionSchedule(manager: EntityManager, row: { id:string; coffeeShopId:string; cafeName:string; timezone:string; planName:string; currentPeriodEndsAt:Date; graceDays:number; graceEndsAt:Date|null }, now: Date) {
    const localDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: row.timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    const days = Math.round((Date.parse(localDate(row.currentPeriodEndsAt)) - Date.parse(localDate(now))) / 86_400_000);
    const reminder = new Map<number, NotificationType>([[3, NotificationType.SubscriptionExpires3Days], [2, NotificationType.SubscriptionExpires2Days], [1, NotificationType.SubscriptionExpires1Day], [0, NotificationType.SubscriptionExpiresToday]]).get(days);
    const cycle = row.currentPeriodEndsAt.toISOString();
    if (reminder) await this.enqueueOwners(manager, { coffeeShopId: row.coffeeShopId, type: reminder, relatedEntityType: "subscription", relatedEntityId: row.id, deduplicationKey: `${reminder}:${row.id}:${cycle}`, payload: { cafeName: row.cafeName, planName: row.planName } });

    const expiredAt = row.graceEndsAt ?? new Date(row.currentPeriodEndsAt.getTime() + row.graceDays * 86_400_000);
    if (now >= expiredAt) await this.enqueueOwners(manager, { coffeeShopId: row.coffeeShopId, type: NotificationType.SubscriptionExpired, relatedEntityType: "subscription", relatedEntityId: row.id, deduplicationKey: `${NotificationType.SubscriptionExpired}:${row.id}:${cycle}`, payload: { cafeName: row.cafeName } });
    if (now >= new Date(expiredAt.getTime() + 3 * 86_400_000)) await this.enqueueOwners(manager, { coffeeShopId: row.coffeeShopId, type: NotificationType.SubscriptionExpiredFollowUp, relatedEntityType: "subscription", relatedEntityId: row.id, deduplicationKey: `${NotificationType.SubscriptionExpiredFollowUp}:${row.id}:${cycle}`, payload: { cafeName: row.cafeName } });
  }

  subscriptionActivatedPayload(cafeName: string, planName: string, expireDate: Date, timezone: string) {
    return { cafeName, planName, expireDate: jalaliDate(expireDate, timezone) };
  }
}
