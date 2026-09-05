import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Branch, CoffeeShop, Domain } from "./entities";
import { AuthSession, OtpChallenge } from "../auth/entities";
import { CoffeeShopMembership, MembershipRole, Permission, Role, RolePermission, User, UserPlatformRole } from "../identity/entities";
import { Subscription, SubscriptionPayment, SubscriptionPlan } from "../subscriptions/entities";
import { BranchOpeningHour, WebsiteSettings } from "../site/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { Reservation, ReservationSettings } from "../reservations/entities";
import { MediaAsset } from "../media/entities";
import { NotificationDelivery } from "../notifications/entities";
import { PaymentIntent } from "../payments/entities";
import { PlatformOrderRequest } from "../platform-orders/entities";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("DATABASE_URL"),
        entities: [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, Role, Permission, MembershipRole, RolePermission, UserPlatformRole, OtpChallenge, AuthSession, SubscriptionPlan, Subscription, SubscriptionPayment, WebsiteSettings, BranchOpeningHour, MenuCategory, MenuItem, MenuItemVariant, Reservation, ReservationSettings, MediaAsset, NotificationDelivery, PaymentIntent, PlatformOrderRequest],
        synchronize: false,
        migrationsRun: false,
        logging: config.get<string>("NODE_ENV") === "development" ? ["error", "warn"] : ["error"],
      }),
    }),
  ],
})
export class DatabaseModule {}
