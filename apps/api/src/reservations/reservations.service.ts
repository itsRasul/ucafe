import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, In } from "typeorm";
import { Client } from "../clients/entities";
import { Branch, CoffeeShop } from "../database/entities";
import { NotificationsService } from "../notifications/notifications.service";
import { BranchOpeningHour } from "../site/entities";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { AvailabilityQueryDto, CreateReservationDto, ReservationListQueryDto, UpdateReservationSettingsDto, UpdateReservationStatusDto } from "./dto/reservation.dto";
import { Reservation, ReservationSettings, ReservationStatus } from "./entities";
import { generateReservationSlots, isValidIsoDate, localDateTimeParts, timeToMinutes } from "./reservation-time.util";

@Injectable()
export class ReservationsService {
  constructor(private readonly dataSource: DataSource, private readonly notifications: NotificationsService, private readonly subscriptions: SubscriptionsService) {}

  private async context(manager: EntityManager, coffeeShopId: string) {
    const branch = await manager.findOneBy(Branch, { coffeeShopId, isPrimary: true, isActive: true });
    if (!branch) throw new NotFoundException("Active primary branch not found");
    let settings = await manager.findOneBy(ReservationSettings, { branchId: branch.id });
    if (!settings) settings = await manager.save(ReservationSettings, manager.create(ReservationSettings, { branchId: branch.id }));
    return { branch, settings };
  }

  private validateDate(date: string, timezone: string, maximumAdvanceDays: number) {
    if (!isValidIsoDate(date)) throw new BadRequestException("Invalid reservation date");
    const today = localDateTimeParts(timezone).date;
    const days = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000;
    if (days < 0 || days > maximumAdvanceDays) throw new BadRequestException("Reservation date is outside the available range");
    return { today, days };
  }

  private async available(manager: EntityManager, coffeeShopId: string, query: AvailabilityQueryDto) {
    const { branch, settings } = await this.context(manager, coffeeShopId);
    if (!settings.isEnabled) throw new BadRequestException("Reservations are currently disabled");
    if (query.partySize < settings.minimumPartySize || query.partySize > settings.maximumPartySize) throw new BadRequestException("Party size is outside the allowed range");
    const { today } = this.validateDate(query.date, branch.timezone, settings.maximumAdvanceDays);
    const dayOfWeek = new Date(`${query.date}T00:00:00Z`).getUTCDay();
    const hours = await manager.findOneBy(BranchOpeningHour, { branchId: branch.id, dayOfWeek });
    if (!hours || hours.isClosed || !hours.opensAt || !hours.closesAt) return { branchId: branch.id, date: query.date, partySize: query.partySize, slots: [] };
    const active = [ReservationStatus.Pending, ReservationStatus.Confirmed];
    const reservations = await manager.findBy(Reservation, { branchId: branch.id, reservationDate: query.date, status: In(active) });
    const localNow = localDateTimeParts(branch.timezone);
    const slots = generateReservationSlots(hours.opensAt, hours.closesAt, settings.slotIntervalMinutes, settings.durationMinutes).map((slot) => {
      const occupied = reservations.filter((r) => r.startTime.slice(0, 5) < slot.endTime && r.endTime.slice(0, 5) > slot.startTime).reduce((sum, r) => sum + r.partySize, 0);
      const leadOkay = query.date !== today || timeToMinutes(slot.startTime) >= localNow.minutes + settings.minimumLeadMinutes;
      return { ...slot, available: leadOkay && occupied + query.partySize <= settings.maximumConcurrentGuests, remainingCapacity: Math.max(0, settings.maximumConcurrentGuests - occupied) };
    });
    return { branchId: branch.id, date: query.date, partySize: query.partySize, slots };
  }

  async availability(coffeeShopId: string, query: AvailabilityQueryDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Reservations);
    return this.available(this.dataSource.manager, coffeeShopId, query);
  }

  async create(coffeeShopId: string, clientId: string, input: CreateReservationDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Reservations);
    return this.dataSource.transaction(async (manager) => {
      const { branch } = await this.context(manager, coffeeShopId);
      if (!await manager.existsBy(Client, { id: clientId, coffeeShopId })) throw new NotFoundException("Client not found");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${branch.id}:${input.date}`]);
      const availability = await this.available(manager, coffeeShopId, input);
      const slot = availability.slots.find((candidate) => candidate.startTime === input.startTime && candidate.available);
      if (!slot) throw new ConflictException("The selected time is no longer available");
      const reservation = await manager.save(Reservation, manager.create(Reservation, {
        coffeeShopId, branchId: branch.id, clientId, contactName: input.contactName.trim(), reservationDate: input.date,
        startTime: slot.startTime, endTime: slot.endTime, partySize: input.partySize, customerNote: input.note?.trim() || null,
      }));
      return this.safe(reservation);
    });
  }

  async mine(coffeeShopId: string, clientId: string) {
    const rows = await this.dataSource.getRepository(Reservation).find({ where: { coffeeShopId, clientId }, order: { reservationDate: "DESC", startTime: "DESC" } });
    return rows.map((row) => this.safe(row));
  }

  async list(coffeeShopId: string, query: ReservationListQueryDto) {
    if (query.date && !isValidIsoDate(query.date)) throw new BadRequestException("Invalid reservation date");
    const rows = await this.dataSource.getRepository(Reservation).find({ relations: { client: true }, where: { coffeeShopId, ...(query.date ? { reservationDate: query.date } : {}), ...(query.status ? { status: query.status } : {}) }, order: { reservationDate: "ASC", startTime: "ASC" } });
    return rows.map((row) => this.adminSafe(row));
  }

  async detail(coffeeShopId: string, id: string) {
    const reservation = await this.dataSource.getRepository(Reservation).findOne({ relations: { client: true }, where: { id, coffeeShopId } });
    if (!reservation) throw new NotFoundException("Reservation not found");
    return this.adminSafe(reservation);
  }

  async updateStatus(coffeeShopId: string, id: string, actorUserId: string, input: UpdateReservationStatusDto) {
    return this.dataSource.transaction(async (manager) => {
    const repository = manager.getRepository(Reservation);
    const reservation = await repository.findOne({ where: { id, coffeeShopId }, lock: { mode: "pessimistic_write" } });
    if (!reservation) throw new NotFoundException("Reservation not found");
    const transitions: Record<ReservationStatus, ReservationStatus[]> = {
      PENDING: [ReservationStatus.Confirmed, ReservationStatus.Rejected, ReservationStatus.Canceled], CONFIRMED: [ReservationStatus.Canceled, ReservationStatus.Completed, ReservationStatus.NoShow],
      REJECTED: [], CANCELED: [], COMPLETED: [], NO_SHOW: [],
    };
    if (!transitions[reservation.status].includes(input.status)) throw new ConflictException("Invalid reservation status transition");
    reservation.status = input.status; reservation.staffNote = input.staffNote?.trim() || null; reservation.statusChangedAt = new Date(); reservation.statusChangedByUserId = actorUserId;
    const saved = await repository.save(reservation);
    const client = await manager.getRepository(Client).findOneByOrFail({ id: reservation.clientId, coffeeShopId });
    if (input.status === ReservationStatus.Confirmed) {
      const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
      await this.notifications.enqueueConfirmation(manager, { coffeeShopId, reservationId: id, phone: client.phone, cafeName: cafe.name, date: reservation.reservationDate, time: reservation.startTime.slice(0, 5) });
    }
    saved.client = client;
    return this.adminSafe(saved);
    });
  }

  async getSettings(coffeeShopId: string) { return (await this.context(this.dataSource.manager, coffeeShopId)).settings; }
  async updateSettings(coffeeShopId: string, input: UpdateReservationSettingsDto) {
    await this.subscriptions.requireFeature(coffeeShopId, SubscriptionFeatures.Reservations);
    const { settings } = await this.context(this.dataSource.manager, coffeeShopId);
    Object.assign(settings, input);
    if (settings.maximumPartySize < settings.minimumPartySize || settings.maximumConcurrentGuests < settings.maximumPartySize) throw new BadRequestException("Reservation capacity settings are inconsistent");
    return this.dataSource.getRepository(ReservationSettings).save(settings);
  }

  private safe(row: Reservation) {
    return { id: row.id, branchId: row.branchId, contactName: row.contactName, reservationDate: row.reservationDate, startTime: row.startTime.slice(0, 5), endTime: row.endTime.slice(0, 5), partySize: row.partySize, status: row.status, customerNote: row.customerNote, staffNote: row.staffNote, createdAt: row.createdAt };
  }

  private adminSafe(row: Reservation) {
    return { ...this.safe(row), customerPhone: row.client?.phone ?? null };
  }
}
