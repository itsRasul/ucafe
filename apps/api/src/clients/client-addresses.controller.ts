import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { ClientAccessTokenGuard } from "./client-access-token.guard";
import { CLIENT_PRINCIPAL, ClientAuthorizedRequest } from "./client-principal";
import { ClientsService } from "./clients.service";
import { CreateClientAddressDto, UpdateClientAddressDto } from "./dto/client-address.dto";

@Controller("public/client-addresses")
@UseGuards(TenantContextGuard, PublicTenantAvailableGuard, ClientAccessTokenGuard)
export class ClientAddressesController {
  constructor(private readonly clients: ClientsService) {}

  @Get()
  list(@Req() request: TenantContextRequest & ClientAuthorizedRequest) {
    return this.clients.addresses(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId);
  }

  @Post()
  create(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Body() input: CreateClientAddressDto) {
    return this.clients.createAddress(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, input);
  }

  @Patch(":id")
  update(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Param("id", ParseUUIDPipe) id: string, @Body() input: UpdateClientAddressDto) {
    return this.clients.updateAddress(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, id, input);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Req() request: TenantContextRequest & ClientAuthorizedRequest, @Param("id", ParseUUIDPipe) id: string) {
    return this.clients.removeAddress(request[TENANT_CONTEXT]!.coffeeShopId, request[CLIENT_PRINCIPAL]!.clientId, id);
  }
}
