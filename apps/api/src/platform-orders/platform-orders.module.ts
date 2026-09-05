import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { SubscriptionPlan } from "../subscriptions/entities";
import { PlatformOrderRequest } from "./entities";
import { PlatformOrdersService } from "./platform-orders.service";
import { PublicPlatformOrdersController } from "./public-platform-orders.controller";

@Module({
  imports: [TypeOrmModule.forFeature([PlatformOrderRequest, SubscriptionPlan]), AuthModule],
  controllers: [PublicPlatformOrdersController],
  providers: [PlatformOrdersService],
})
export class PlatformOrdersModule {}
