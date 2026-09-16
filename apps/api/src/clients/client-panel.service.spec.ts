import assert from "node:assert/strict";
import test from "node:test";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { Branch } from "../database/entities";
import { ClientOrdersQueryDto } from "../ordering/dto/ordering.dto";
import { Order, OrderDeliveryMethod, OrderPaymentMethod, OrderStatus } from "../ordering/entities";
import { OrderingService } from "../ordering/ordering.service";
import { ClientReservationsQueryDto } from "../reservations/dto/reservation.dto";
import { Reservation, ReservationStatus } from "../reservations/entities";
import { ReservationsService } from "../reservations/reservations.service";
import { ClientsService } from "./clients.service";
import { UpdateClientProfileDto } from "./dto/client-panel.dto";

test("client-panel DTOs reject blank names and bound pagination at fifty", async () => {
  const profile = plainToInstance(UpdateClientProfileDto, { firstName: "   ", lastName: "کاربر" });
  const orderQuery = plainToInstance(ClientOrdersQueryDto, { page: "1", pageSize: "51" });
  const reservationQuery = plainToInstance(ClientReservationsQueryDto, { page: "0", pageSize: "10" });
  assert.ok((await validate(profile)).length > 0);
  assert.ok((await validate(orderQuery)).length > 0);
  assert.ok((await validate(reservationQuery)).length > 0);
});

test("overview returns tenant-and-client scoped counts and current records", async () => {
  const scoped: object[] = [];
  const latestOrder = Object.assign(new Order(), { id: "order-1", status: OrderStatus.Preparing, deliveryMethod: OrderDeliveryMethod.Pickup, totalAmountToman: "240000", createdAt: new Date() });
  const nextReservation = Object.assign(new Reservation(), { id: "reservation-1", reservationDate: "2099-01-01", startTime: "18:30:00", partySize: 2, status: ReservationStatus.Confirmed, branch: Object.assign(new Branch(), { name: "شعبه مرکزی", address: "تهران" }) });
  const builder = {
    where(_sql: string, values: object) { scoped.push(values); return this; },
    andWhere(_sql: string, values: object) { scoped.push(values); return this; },
    clone() { return this; },
    leftJoinAndSelect() { return this; },
    orderBy() { return this; },
    addOrderBy() { return this; },
    async getCount() { return 2; },
    async getOne() { return nextReservation; },
  };
  const dataSource = { getRepository: (entity: unknown) => entity === Branch ? { findOneBy: async () => Object.assign(new Branch(), { timezone: "Asia/Tehran" }) } : entity === Order ? { countBy: async (where: object) => { scoped.push(where); return 3; }, findOne: async (options: { where: object }) => { scoped.push(options.where); return latestOrder; } } : { countBy: async (where: object) => { scoped.push(where); return 4; }, createQueryBuilder: () => builder } };
  const result = await new ClientsService(dataSource as never).overview("tenant-a", "client-a");
  assert.deepEqual(result.counts, { totalOrders: 3, activeOrders: 3, totalReservations: 4, upcomingReservations: 2 });
  assert.equal(result.latestOrder?.id, "order-1");
  assert.equal(result.nextReservation?.id, "reservation-1");
  assert.ok(scoped.filter((where) => (where as { coffeeShopId?: string }).coffeeShopId === "tenant-a").length >= 5);
  assert.ok(scoped.filter((where) => (where as { clientId?: string }).clientId === "client-a").length >= 5);
});

test("order and reservation histories keep tenant and client scope in list and detail queries", async () => {
  const calls: Array<{ entity: unknown; operation: string; options: unknown }> = [];
  const order = Object.assign(new Order(), { id: "order-a", status: OrderStatus.UnderReview, deliveryMethod: OrderDeliveryMethod.Courier, paymentMethod: OrderPaymentMethod.Offline, totalAmountToman: "100000", createdAt: new Date(), updatedAt: new Date(), items: [] });
  const reservation = Object.assign(new Reservation(), { id: "reservation-a", reservationDate: "2099-01-01", startTime: "10:00:00", endTime: "11:00:00", partySize: 2, status: ReservationStatus.Pending, contactName: "کاربر", customerNote: null, createdAt: new Date(), branch: Object.assign(new Branch(), { id: "branch-a", name: "مرکزی", address: "تهران" }) });
  const repositories = new Map<unknown, object>([
    [Order, { findAndCount: async (options: unknown) => { calls.push({ entity: Order, operation: "list", options }); return [[order], 1]; }, findOne: async (options: unknown) => { calls.push({ entity: Order, operation: "detail", options }); return order; } }],
    [Reservation, { findAndCount: async (options: unknown) => { calls.push({ entity: Reservation, operation: "list", options }); return [[reservation], 1]; }, findOne: async (options: unknown) => { calls.push({ entity: Reservation, operation: "detail", options }); return reservation; } }],
  ]);
  const dataSource = { getRepository: (entity: unknown) => repositories.get(entity) };
  const ordering = new OrderingService(dataSource as never, {} as never);
  const reservations = new ReservationsService(dataSource as never, {} as never, {} as never);
  const orderList = await ordering.clientList("tenant-a", "client-a", Object.assign(new ClientOrdersQueryDto(), { page: 2, pageSize: 10 }));
  const orderDetail = await ordering.clientDetail("tenant-a", "client-a", "order-a");
  const reservationList = await reservations.mine("tenant-a", "client-a", Object.assign(new ClientReservationsQueryDto(), { page: 1, pageSize: 10 }));
  const reservationDetail = await reservations.clientDetail("tenant-a", "client-a", "reservation-a");
  assert.equal(orderList.page, 2);
  assert.equal(orderDetail.id, "order-a");
  assert.equal(reservationList.total, 1);
  assert.equal(reservationDetail.branch?.name, "مرکزی");
  for (const call of calls) {
    const where = (call.options as { where: { coffeeShopId: string; clientId: string } }).where;
    assert.equal(where.coffeeShopId, "tenant-a");
    assert.equal(where.clientId, "client-a");
  }
});
