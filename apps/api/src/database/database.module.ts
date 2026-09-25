import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TypeOrmModule } from "@nestjs/typeorm";
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
import { Client, ClientAddress, ClientAuthSession, CustomerSegment, CustomerSegmentMembership } from "../clients/entities";
import { OnlineOrderingSettings, Order, OrderItem } from "../ordering/entities";
import { InventoryBatch, InventoryBatchChange, InventoryCategory, InventoryGoodsReceipt, InventoryGoodsReceiptLine, InventoryItem, InventoryLocation, InventoryPurchaseOrder, InventoryPurchaseOrderItem, InventoryRecipe, InventoryRecipeComponent, InventoryRecipeVersion, InventoryStockAlert, InventoryStockBalance, InventoryStockCount, InventoryStockCountLine, InventoryStockMovement, InventoryStockRule, InventorySupplier, InventoryWasteItem, InventoryWasteRecord } from "../inventory/entities";
import { Promotion, PromotionAdvancedRule, PromotionCoupon, PromotionCustomerCondition, PromotionQuantityTier, PromotionRedemption, PromotionRuleGroup, PromotionRuleTarget, PromotionScheduleWindow, PromotionTarget } from "../promotions/entities";

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: "postgres" as const,
        url: config.getOrThrow<string>("DATABASE_URL"),
        entities: [CoffeeShop, Branch, Domain, User, CoffeeShopMembership, Role, Permission, MembershipRole, RolePermission, UserPlatformRole, OtpChallenge, AuthSession, Client, ClientAddress, ClientAuthSession, CustomerSegment, CustomerSegmentMembership, SubscriptionPlan, Subscription, SubscriptionPayment, SubscriptionPeriod, WebsiteSettings, BranchOpeningHour, MenuCategory, MenuItem, MenuItemVariant, Reservation, ReservationSettings, MediaAsset, NotificationDelivery, PaymentIntent, PlatformOrderRequest, OnlineOrderingSettings, Order, OrderItem, Promotion, PromotionTarget, PromotionCoupon, PromotionRedemption, PromotionScheduleWindow, PromotionAdvancedRule, PromotionRuleGroup, PromotionRuleTarget, PromotionQuantityTier, PromotionCustomerCondition, InventoryCategory, InventoryItem, InventoryLocation, InventoryStockMovement, InventoryStockBalance, InventoryStockCount, InventoryStockCountLine, InventoryStockRule, InventoryStockAlert, InventoryWasteRecord, InventoryWasteItem, InventoryBatch, InventoryBatchChange, InventoryRecipe, InventoryRecipeVersion, InventoryRecipeComponent, InventorySupplier, InventoryPurchaseOrder, InventoryPurchaseOrderItem, InventoryGoodsReceipt, InventoryGoodsReceiptLine],
        synchronize: false,
        migrationsRun: false,
        logging: config.get<string>("NODE_ENV") === "development" ? ["error", "warn"] : ["error"],
      }),
    }),
  ],
})
export class DatabaseModule {}
