import { Body, Controller, Get, Header, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { CreateCheckoutDto } from "./dto/payment.dto";
import { PreparePurchaseDto, PurchaseInvoiceDto, PurchaseSlugDto } from "./dto/public-purchase.dto";
import { PublicPurchaseService } from "./public-purchase.service";

@Controller("public/platform")
export class PublicPurchaseController {
  constructor(private readonly service: PublicPurchaseService) {}

  @Get("plans")
  @Header("Cache-Control", "no-store")
  catalog() { return this.service.catalog(); }

  @Get("purchase/availability")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  availability(@Query() input: PurchaseSlugDto) { return this.service.availability(input.slug); }

  @Get("purchase/drafts")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  drafts(@Req() request: AuthorizedRequest) { return this.service.drafts(request[AUTH_PRINCIPAL]!.userId); }

  @Get("purchase/cafes")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  cafes(@Req() request: AuthorizedRequest) { return this.service.cafes(request[AUTH_PRINCIPAL]!.userId); }

  @Post("purchase/prepare")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  prepare(@Req() request: AuthorizedRequest, @Body() input: PreparePurchaseDto) { return this.service.prepare(request[AUTH_PRINCIPAL]!.userId, input); }

  @Post("purchase/:slug/checkout")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  checkout(@Req() request: AuthorizedRequest, @Param() input: PurchaseSlugDto, @Body() body: CreateCheckoutDto) { return this.service.checkout(request[AUTH_PRINCIPAL]!.userId, input.slug, body); }

  @Get("purchase/:slug/invoices/:intentId")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  invoice(@Req() request: AuthorizedRequest, @Param() input: PurchaseInvoiceDto) { return this.service.invoice(request[AUTH_PRINCIPAL]!.userId, input.slug, input.intentId); }

  @Get("purchase/:slug/invoices")
  @UseGuards(AccessTokenGuard)
  @Header("Cache-Control", "private, no-store")
  invoices(@Req() request: AuthorizedRequest, @Param() input: PurchaseSlugDto) { return this.service.invoices(request[AUTH_PRINCIPAL]!.userId, input.slug); }
}
