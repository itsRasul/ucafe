import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, EntityManager, In, Not } from "typeorm";
import { Client } from "../clients/entities";
import { Branch, CoffeeShop } from "../database/entities";
import { NotificationsService } from "../notifications/notifications.service";
import { jalaliDate, NotificationType } from "../notifications/notification-type";
import { BranchOpeningHour } from "../site/entities";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";
import { SubscriptionFeatures } from "../subscriptions/subscription-features";
import { AvailabilityQueryDto, CreateReservationDto, ReservationListQueryDto, UpdateReservationDto, UpdateReservationSettingsDto, UpdateReservationStatusDto } from "./dto/reservation.dto";
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

  private async available(manager: EntityManager, coffeeShopId: string, query: AvailabilityQueryDto, excludeReservationId?: string) {
    const { branch, settings } = await this.context(manager, coffeeShopId);
    if (!settings.isEnabled) throw new BadRequestException("Reservations are currently disabled");
    if (query.partySize < settings.minimumPartySize || query.partySize > settings.maximumPartySize) throw new BadRequestException("Party size is outside the allowed range");
    const { today } = this.validateDate(query.date, branch.timezone, settings.maximumAdvanceDays);
    const dayOfWeek = new Date(`${query.date}T00:00:00Z`).getUTCDay();
    const hours = await manager.findOneBy(BranchOpeningHour, { branchId: branch.id, dayOfWeek });
    if (!hours || hours.isClosed || !hours.opensAt || !hours.closesAt) return { branchId: branch.id, date: query.date, partySize: query.partySize, slots: [] };
    const active = [ReservationStatus.Pending, ReservationStatus.Confirmed];
    const reservations = await manager.findBy(Reservation, { branchId: branch.id, reservationDate: query.date, status: In(active), ...(excludeReservationId ? { id: Not(excludeReservationId) } : {}) });
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
      const client = await manager.findOneBy(Client, { id: clientId, coffeeShopId });
      if (!client) throw new NotFoundException("Client not found");
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${branch.id}:${input.date}`]);
      const availability = await this.available(manager, coffeeShopId, input);
      const slot = availability.slots.find((candidate) => candidate.startTime === input.startTime && candidate.available);
      if (!slot) throw new ConflictException("The selected time is no longer available");
      const reservation = await manager.save(Reservation, manager.create(Reservation, {
        coffeeShopId, branchId: branch.id, clientId, contactName: input.contactName.trim(), reservationDate: input.date,
        startTime: slot.startTime, endTime: slot.endTime, partySize: input.partySize, customerNote: input.note?.trim() || null,
      }));
      const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
      const payload = { customerName: reservation.contactName, cafeName: cafe.name, guestCount: String(reservation.partySize), date: jalaliDate(reservation.reservationDate), time: reservation.startTime.slice(0, 5) };
      await this.notifications.enqueue(manager, { coffeeShopId, type: NotificationType.ReservationPlaced, relatedEntityType: "reservation", relatedEntityId: reservation.id, deduplicationKey: `${NotificationType.ReservationPlaced}:${reservation.id}`, phone: client.phone, payload });
      const settings = await manager.findOneByOrFail(ReservationSettings, { branchId: branch.id });
      if (settings.notifyAdminNewReservation) await this.notifications.enqueueOwners(manager, { coffeeShopId, type: NotificationType.AdminNewReservation, relatedEntityType: "reservation", relatedEntityId: reservation.id, deduplicationKey: `${NotificationType.AdminNewReservation}:${reservation.id}`, payload: { cafeName: cafe.name, guestCount: payload.guestCount, date: payload.date, time: payload.time } });
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
      await this.notifications.enqueue(manager, { coffeeShopId, type: NotificationType.ReservationConfirmed, relatedEntityType: "reservation", relatedEntityId: id, deduplicationKey: `${NotificationType.ReservationConfirmed}:${id}`, phone: client.phone, payload: { customerName: reservation.contactName, cafeName: cafe.name, date: jalaliDate(reservation.reservationDate), time: reservation.startTime.slice(0, 5), guestCount: String(reservation.partySize) } });
    } else if (input.status === ReservationStatus.Canceled) {
      const cafe = await manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId });
      await this.notifications.enqueue(manager, { coffeeShopId, type: NotificationType.ReservationCancelled, relatedEntityType: "reservation", relatedEntityId: id, deduplicationKey: `${NotificationType.ReservationCancelled}:${id}`, phone: client.phone, payload: { customerName: reservation.contactName, cafeName: cafe.name, date: jalaliDate(reservation.reservationDate), time: reservation.startTime.slice(0, 5) } });
    }
    saved.client = client;
    return this.adminSafe(saved);
    });
  }

  async update(coffeeShopId: string, id: string, input: UpdateReservationDto) {
    return this.dataSource.transaction(async (manager) => {
      const reservation = await manager.getRepository(Reservation).findOne({ where: { id, coffeeShopId }, lock: { mode: "pessimistic_write" } });
      if (!reservation) throw new NotFoundException("Reservation not found");
      if (![ReservationStatus.Pending, ReservationStatus.Confirmed].includes(reservation.status)) throw new ConflictException("Reservation can no longer be edited");
      const date = input.date ?? reservation.reservationDate;
      const startTime = input.startTime ?? reservation.startTime.slice(0, 5);
      const partySize = input.partySize ?? reservation.partySize;
      if (date === reservation.reservationDate && startTime === reservation.startTime.slice(0, 5) && partySize === reservation.partySize) return this.adminSafe({ ...reservation, client: await manager.findOneByOrFail(Client, { id: reservation.clientId, coffeeShopId }) });
      const availability = await this.available(manager, coffeeShopId, { date, partySize }, id);
      const slot = availability.slots.find((candidate) => candidate.startTime === startTime && candidate.available);
      if (!slot) throw new ConflictException("The selected time is no longer available");
      reservation.reservationDate = date; reservation.startTime = slot.startTime; reservation.endTime = slot.endTime; reservation.partySize = partySize;
      const saved = await manager.save(reservation);
      const [client, cafe] = await Promise.all([manager.findOneByOrFail(Client, { id: reservation.clientId, coffeeShopId }), manager.findOneByOrFail(CoffeeShop, { id: coffeeShopId })]);
      await this.notifications.enqueue(manager, { coffeeShopId, type: NotificationType.ReservationEdited, relatedEntityType: "reservation", relatedEntityId: id, deduplicationKey: `${NotificationType.ReservationEdited}:${id}:${saved.updatedAt.toISOString()}`, phone: client.phone, payload: { customerName: saved.contactName, cafeName: cafe.name, date: jalaliDate(saved.reservationDate), time: saved.startTime.slice(0, 5), guestCount: String(saved.partySize) } });
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
