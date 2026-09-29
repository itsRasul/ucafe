import { Module } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import { SentryModule } from "@sentry/nestjs/setup";
import { AuthorizationModule } from "./authorization/authorization.module";
import { AuthModule } from "./auth/auth.module";
import { ConfigModule } from "@nestjs/config";
import { environmentSchema } from "./config/environment.schema";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health.controller";
import { IdentityAccessModule } from "./identity/identity-access.module";
import { TenantsModule } from "./tenants/tenants.module";
import { SubscriptionsModule } from "./subscriptions/subscriptions.module";
import { SiteModule } from "./site/site.module";
import { MenuModule } from "./menu/menu.module";
import { ReservationsModule } from "./reservations/reservations.module";
import { AuditModule } from "./audit/audit.module";
import { MediaModule } from "./media/media.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PaymentsModule } from "./payments/payments.module";
import { PlatformOrdersModule } from "./platform-orders/platform-orders.module";
import { PlatformAccessModule } from "./identity/platform-access.module";
import { ClientsModule } from "./clients/clients.module";
import { OrderingModule } from "./ordering/ordering.module";
import { AnalyticsModule } from "./analytics/analytics.module";
import { InventoryModule } from "./inventory/inventory.module";
import { CrmModule } from "./crm/crm.module";
import { TenantCrmModule } from "./tenant-crm/tenant-crm.module";
import { UcafeSentryGlobalFilter } from "./observability/sentry-global.filter";

@Module({
  imports: [
    SentryModule.forRoot(),
    AuthorizationModule,
    AuthModule,
    ConfigModule.forRoot({
      envFilePath: [".env", "../../.env"],
      isGlobal: true,
      cache: true,
      validationSchema: environmentSchema,
    }),
    DatabaseModule,
    IdentityAccessModule,
    TenantsModule,
    SubscriptionsModule,
    SiteModule,
    MenuModule,
    ReservationsModule,
    AuditModule,
    MediaModule,
    NotificationsModule,
    PaymentsModule,
    PlatformOrdersModule,
    PlatformAccessModule,
    ClientsModule,
    OrderingModule,
    AnalyticsModule,
    InventoryModule,
    CrmModule,
    TenantCrmModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: UcafeSentryGlobalFilter }],
})
export class AppModule {}
