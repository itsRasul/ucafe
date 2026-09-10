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
        addressLine: input.addressLine.trim(),
        isDefault: input.isDefault ?? false,
      }));
      return this.safeAddress(address);
    });
  }

  safeClient(client: Client) {
    return { id: client.id, firstName: client.firstName, lastName: client.lastName, phone: client.phone, status: client.status, createdAt: client.createdAt };
  }

  safeAddress(address: ClientAddress) {
    return { id: address.id, label: address.label, addressLine: address.addressLine, isDefault: address.isDefault, createdAt: address.createdAt };
  }
}
