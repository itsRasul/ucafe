import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CoffeeShop } from "../database/entities";
import { Subscription, SubscriptionPayment, SubscriptionPeriod, SubscriptionPlan } from "./entities";
import { PlatformSubscriptionsController } from "./platform-subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { TenantSubscriptionController } from "./tenant-subscription.controller";
import { PlatformPlansController } from "./platform-plans.controller";
import { AuditModule } from "../audit/audit.module";
import { NotificationsModule } from "../notifications/notifications.module";

@Module({
  imports: [NotificationsModule, TypeOrmModule.forFeature([CoffeeShop, SubscriptionPlan, Subscription, SubscriptionPayment, SubscriptionPeriod]), AuthModule, AuthorizationModule, AuditModule],
  controllers: [PlatformSubscriptionsController, PlatformPlansController, TenantSubscriptionController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
