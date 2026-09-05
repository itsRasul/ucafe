import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CoffeeShop } from "../database/entities";
import { Subscription, SubscriptionPayment, SubscriptionPlan } from "./entities";
import { PlatformSubscriptionsController } from "./platform-subscriptions.controller";
import { SubscriptionsService } from "./subscriptions.service";
import { TenantSubscriptionController } from "./tenant-subscription.controller";
import { PlatformPlansController } from "./platform-plans.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoffeeShop, SubscriptionPlan, Subscription, SubscriptionPayment]), AuthModule, AuthorizationModule, AuditModule],
  controllers: [PlatformSubscriptionsController, PlatformPlansController, TenantSubscriptionController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
