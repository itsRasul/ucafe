import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, In, IsNull } from "typeorm";
import { Branch } from "../database/entities";
import { Order, OrderStatus } from "../ordering/entities";
import { Reservation, ReservationStatus } from "../reservations/entities";
import { localDateTimeParts } from "../reservations/reservation-time.util";
import { UpdateClientProfileDto } from "./dto/client-panel.dto";
import { Client, ClientAddress } from "./entities";
import { CreateClientAddressDto } from "./dto/client-address.dto";

@Injectable()
export class ClientsService {
  constructor(private readonly dataSource: DataSource) {}

  async me(coffeeShopId: string, clientId: string) {
    const client = await this.dataSource.getRepository(Client).findOneBy({ id: clientId, coffeeShopId });
    if (!client) throw new NotFoundException("Client not found");
    return this.safeClient(client);
  }

  async updateProfile(coffeeShopId: string, clientId: string, input: UpdateClientProfileDto) {
    const repository = this.dataSource.getRepository(Client);
    const client = await repository.findOneBy({ id: clientId, coffeeShopId });
    if (!client) throw new NotFoundException("Client not found");
    client.firstName = input.firstName.trim().replace(/\s+/g, " ");
    client.lastName = input.lastName.trim().replace(/\s+/g, " ");
    return this.safeClient(await repository.save(client));
  }

  async overview(coffeeShopId: string, clientId: string) {
    const orders = this.dataSource.getRepository(Order);
    const reservations = this.dataSource.getRepository(Reservation);
    const branch = await this.dataSource.getRepository(Branch).findOneBy({ coffeeShopId, isPrimary: true });
    const localNow = localDateTimeParts(branch?.timezone ?? "Asia/Tehran");
    const activeReservations = [ReservationStatus.Pending, ReservationStatus.Confirmed];
    const upcoming = reservations.createQueryBuilder("reservation")
      .where("reservation.coffeeShopId = :coffeeShopId", { coffeeShopId })
      .andWhere("reservation.clientId = :clientId", { clientId })
      .andWhere("reservation.status IN (:...statuses)", { statuses: activeReservations })
      .andWhere("(reservation.reservationDate > :date OR (reservation.reservationDate = :date AND reservation.startTime >= :time))", { date: localNow.date, time: `${String(Math.floor(localNow.minutes / 60)).padStart(2, "0")}:${String(localNow.minutes % 60).padStart(2, "0")}` });
    const [totalOrders, activeOrders, totalReservations, upcomingReservations, latestOrder, nextReservation] = await Promise.all([
      orders.countBy({ coffeeShopId, clientId }),
      orders.countBy({ coffeeShopId, clientId, status: In([OrderStatus.UnderReview, OrderStatus.Preparing, OrderStatus.Ready, OrderStatus.OutForDelivery]) }),
      reservations.countBy({ coffeeShopId, clientId }),
      upcoming.getCount(),
      orders.findOne({ where: { coffeeShopId, clientId }, order: { createdAt: "DESC" } }),
      upcoming.clone().leftJoinAndSelect("reservation.branch", "branch").orderBy("reservation.reservationDate", "ASC").addOrderBy("reservation.startTime", "ASC").getOne(),
    ]);
    return {
      counts: { totalOrders, activeOrders, totalReservations, upcomingReservations },
      latestOrder: latestOrder ? { id: latestOrder.id, status: latestOrder.status, deliveryMethod: latestOrder.deliveryMethod, totalAmountToman: latestOrder.totalAmountToman, createdAt: latestOrder.createdAt } : null,
      nextReservation: nextReservation ? { id: nextReservation.id, reservationDate: nextReservation.reservationDate, startTime: nextReservation.startTime.slice(0, 5), partySize: nextReservation.partySize, status: nextReservation.status, branch: nextReservation.branch ? { name: nextReservation.branch.name, address: nextReservation.branch.address } : null } : null,
    };
  }

  async addresses(coffeeShopId: string, clientId: string) {
    const rows = await this.dataSource.getRepository(ClientAddress).find({ where: { coffeeShopId, clientId, deletedAt: IsNull() }, order: { isDefault: "DESC", createdAt: "DESC" } });
    return rows.map((row) => this.safeAddress(row));
  }

  async createAddress(coffeeShopId: string, clientId: string, input: CreateClientAddressDto) {
    return this.dataSource.transaction(async (manager) => {
      if (!await manager.existsBy(Client, { id: clientId, coffeeShopId })) throw new NotFoundException("Client not found");
      if (input.isDefault) await manager.update(ClientAddress, { coffeeShopId, clientId, deletedAt: IsNull() }, { isDefault: false });
      const address = await manager.save(ClientAddress, manager.create(ClientAddress, {
        coffeeShopId,
        clientId,
        label: input.label?.trim() || null,
        province: input.province.trim(),
        city: input.city.trim(),
        addressLine: input.addressLine.trim(),
        buildingNumber: input.buildingNumber.trim(),
        unit: input.unit?.trim() || null,
        postalCode: input.postalCode || null,
        isDefault: input.isDefault ?? false,
      }));
      return this.safeAddress(address);
    });
  }

  async removeAddress(coffeeShopId: string, clientId: string, id: string) {
    const repository = this.dataSource.getRepository(ClientAddress);
    const address = await repository.findOneBy({ id, coffeeShopId, clientId, deletedAt: IsNull() });
    if (!address) throw new NotFoundException("Client address not found");
    await repository.softRemove(address);
  }

  async updateAddress(coffeeShopId: string, clientId: string, id: string, input: CreateClientAddressDto) {
    return this.dataSource.transaction(async (manager) => {
      const address = await manager.findOneBy(ClientAddress, { id, coffeeShopId, clientId, deletedAt: IsNull() });
      if (!address) throw new NotFoundException("Client address not found");
      if (input.isDefault) await manager.update(ClientAddress, { coffeeShopId, clientId, deletedAt: IsNull() }, { isDefault: false });
      Object.assign(address, { label: input.label?.trim() || null, province: input.province.trim(), city: input.city.trim(), addressLine: input.addressLine.trim(), buildingNumber: input.buildingNumber.trim(), unit: input.unit?.trim() || null, postalCode: input.postalCode || null, isDefault: input.isDefault ?? address.isDefault });
      return this.safeAddress(await manager.save(address));
    });
  }

  safeClient(client: Client) {
    return { id: client.id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, status: client.status, createdAt: client.createdAt };
  }

  safeAddress(address: ClientAddress) {
    return { id: address.id, label: address.label, province: address.province, city: address.city, addressLine: address.addressLine, buildingNumber: address.buildingNumber, unit: address.unit, postalCode: address.postalCode, isDefault: address.isDefault, createdAt: address.createdAt };
  }
}
