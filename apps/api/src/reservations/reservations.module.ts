import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { ClientsModule } from "../clients/clients.module";
import { Branch } from "../database/entities";
import { BranchOpeningHour } from "../site/entities";
import { PublicTenantAvailableGuard } from "../tenants/public-tenant-available.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { Reservation, ReservationSettings } from "./entities";
import { PublicReservationsController } from "./public-reservations.controller";
import { ReservationsService } from "./reservations.service";
import { TenantReservationsController } from "./tenant-reservations.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";

@Module({
  imports: [NotificationsModule, ClientsModule, SubscriptionsModule, TypeOrmModule.forFeature([Branch, BranchOpeningHour, Reservation, ReservationSettings]), AuthModule, AuthorizationModule],
  controllers: [PublicReservationsController, TenantReservationsController],
  providers: [ReservationsService, TenantContextGuard, PublicTenantAvailableGuard],
})
export class ReservationsModule {}
