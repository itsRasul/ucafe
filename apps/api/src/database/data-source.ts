import "dotenv/config";
import { DataSource } from "typeorm";
import { Branch, CoffeeShop, Domain } from "./entities";
import { AuthSession, OtpChallenge } from "../auth/entities";
import { CoffeeShopMembership, MembershipRole, Permission, Role, RolePermission, User, UserPlatformRole } from "../identity/entities";
import { Subscription, SubscriptionPayment, SubscriptionPeriod, SubscriptionPlan } from "../subscriptions/entities";
import { BranchOpeningHour, WebsiteSettings } from "../site/entities";
import { MenuCategory, MenuItem, MenuItemVariant } from "../menu/entities";
import { Reservation, ReservationSettings } from "../reservations/entities";
import { MediaAsset } from "../media/entities";
import { NotificationDelivery } from "../notifications/entities";
import { PaymentIntent } from "../payments/entities";
import { PlatformOrderRequest } from "../platform-orders/entities";
import { Client, ClientAddress, ClientAuthSession } from "../clients/entities";
import { OnlineOrderingSettings, Order, OrderItem } from "../ordering/entities";
import { InventoryBatch, InventoryBatchChange, InventoryCategory, InventoryGoodsReceipt, InventoryGoodsReceiptLine, InventoryItem, InventoryLocation, InventoryPurchaseOrder, InventoryPurchaseOrderItem, InventoryRecipe, InventoryRecipeComponent, InventoryRecipeVersion, InventoryStockAlert, InventoryStockBalance, InventoryStockCount, InventoryStockCountLine, InventoryStockMovement, InventoryStockRule, InventorySupplier, InventoryWasteItem, InventoryWasteRecord } from "../inventory/entities";
import { Promotion, PromotionAdvancedRule, PromotionCoupon, PromotionQuantityTier, PromotionRedemption, PromotionRuleGroup, PromotionRuleTarget, PromotionScheduleWindow, PromotionTarget } from "../promotions/entities";

const localDatabaseUrl = "postgresql://ucafe:ucafe@localhost:5432/ucafe";

export default new DataSource({
  type: "postgres",
  url: process.env.DATABASE_URL ?? localDatabaseUrl,
  entities: [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, Role, Permission, MembershipRole, RolePermission, UserPlatformRole, OtpChallenge, AuthSession, Client, ClientAddress, ClientAuthSession, SubscriptionPlan, Subscription, SubscriptionPayment, SubscriptionPeriod, WebsiteSettings, BranchOpeningHour, MenuCategory, MenuItem, MenuItemVariant, Reservation, ReservationSettings, MediaAsset, NotificationDelivery, PaymentIntent, PlatformOrderRequest, OnlineOrderingSettings, Order, OrderItem, Promotion, PromotionTarget, PromotionCoupon, PromotionRedemption, PromotionScheduleWindow, PromotionAdvancedRule, PromotionRuleGroup, PromotionRuleTarget, PromotionQuantityTier, InventoryCategory, InventoryItem, InventoryLocation, InventoryStockMovement, InventoryStockBalance, InventoryStockCount, InventoryStockCountLine, InventoryStockRule, InventoryStockAlert, InventoryWasteRecord, InventoryWasteItem, InventoryBatch, InventoryBatchChange, InventoryRecipe, InventoryRecipeVersion, InventoryRecipeComponent, InventorySupplier, InventoryPurchaseOrder, InventoryPurchaseOrderItem, InventoryGoodsReceipt, InventoryGoodsReceiptLine],
  migrations: [__dirname + "/migrations/*{.ts,.js}"],
  synchronize: false,
  migrationsRun: false,
});
