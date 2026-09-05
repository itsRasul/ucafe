import { Body, Controller, Get, Post } from "@nestjs/common";
import { CreatePlatformOrderRequestDto } from "./dto/create-platform-order-request.dto";
import { PlatformOrdersService } from "./platform-orders.service";

@Controller("public/platform")
export class PublicPlatformOrdersController {
  constructor(private readonly orders: PlatformOrdersService) {}

  @Get("offering") offering() { return this.orders.getPublicOffering(); }
  @Post("order-requests") create(@Body() input: CreatePlatformOrderRequestDto) { return this.orders.create(input); }
}
