import "dotenv/config";
import { DataSource } from "typeorm";
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

const localDatabaseUrl = "postgresql://cafexa:cafexa@localhost:5432/cafexa";

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL ?? localDatabaseUrl,
  entities: [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, Role, Permission, MembershipRole, RolePermission, UserPlatformRole, OtpChallenge, AuthSession, SubscriptionPlan, Subscription, SubscriptionPayment, WebsiteSettings, BranchOpeningHour, MenuCategory, MenuItem, MenuItemVariant, Reservation, ReservationSettings, MediaAsset, NotificationDelivery, PaymentIntent, PlatformOrderRequest],
  migrations: [__dirname + "/migrations/*{.ts,.js}"],
  synchronize: false,
  migrationsRun: false,
});
