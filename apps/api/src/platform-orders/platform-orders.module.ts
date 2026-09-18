import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { SubscriptionPlan } from "../subscriptions/entities";
import { PlatformOrderRequest } from "./entities";
import { PlatformOrdersService } from "./platform-orders.service";
import { PublicPlatformOrdersController } from "./public-platform-orders.controller";
import { PlatformOrdersController } from "./platform-orders.controller";
import { NotificationsModule } from "../notifications/notifications.module";
import { AuthorizationModule } from "../authorization/authorization.module";

@Module({
  imports: [TypeOrmModule.forFeature([PlatformOrderRequest, SubscriptionPlan]), AuthModule, AuthorizationModule, NotificationsModule],
  controllers: [PublicPlatformOrdersController, PlatformOrdersController],
  providers: [PlatformOrdersService],
})
export class PlatformOrdersModule {}
