import { Module } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { TenantsModule } from "../tenants/tenants.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PaymentIntent } from "./entities";
import { PAYMENT_GATEWAY } from "./payment-gateway";
import { PlatformPaymentsController, PublicPaymentsController, TenantPaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";
import { SimulatedGateway } from "./simulated.gateway";
import { ZarinpalGateway } from "./zarinpal.gateway";
import { PublicPurchaseController } from "./public-purchase.controller";
import { PublicPurchaseService } from "./public-purchase.service";

@Module({
  imports: [NotificationsModule, TypeOrmModule.forFeature([PaymentIntent]), AuthModule, AuthorizationModule, SubscriptionsModule, TenantsModule],
  controllers: [TenantPaymentsController, PlatformPaymentsController, PublicPaymentsController, PublicPurchaseController],
  providers: [PaymentsService, PublicPurchaseService, TenantContextGuard, { provide: PAYMENT_GATEWAY, inject: [ConfigService], useFactory: (config: ConfigService) => config.get("PAYMENT_PROVIDER", "simulated") === "zarinpal" ? new ZarinpalGateway(config) : new SimulatedGateway() }],
})
export class PaymentsModule {}
