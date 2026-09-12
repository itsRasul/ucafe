import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
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
