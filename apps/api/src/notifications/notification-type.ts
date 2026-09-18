export enum NotificationType {
  RequestCounseling = "REQUEST_COUNSELING",
  OrderPlaced = "ORDER_PLACED",
  OrderConfirmed = "ORDER_CONFIRMED",
  OrderReadyOnSite = "ORDER_READY_ON_SITE",
  OrderReadyDelivery = "ORDER_READY_DELIVERY",
  OrderCompleted = "ORDER_COMPLETED",
  OrderCancelled = "ORDER_CANCELLED",
  AdminNewOrder = "ORDER_PLACED_FOR_ADMIN_TENANT",
  ReservationPlaced = "RESERVATION_PLACED",
  ReservationConfirmed = "RESERVATION_CONFIRMED",
  ReservationEdited = "RESERVATION_EDITED_BY_ADMIN",
  ReservationCancelled = "RESERVATION_CANCELLED",
  AdminNewReservation = "RESERVATION_PLACED_TO_ADMIN",
  ReservationReminder = "RESERVATION_REMINDER",
  SubscriptionExpires3Days = "RENEWING_SUBSCRIPTION_REMINDER_3",
  SubscriptionExpires2Days = "RENEWING_REMINDER_SUBSCRIPTION_2",
  SubscriptionExpires1Day = "RENEWING_SUBSCRIPTION_REMINDER_1",
  SubscriptionExpiresToday = "RENEWING_SUBSCRIPTION_LAST_DAY",
  SubscriptionExpired = "SUBSCRIPTION_EXPIRED",
  SubscriptionExpiredFollowUp = "SUBSCRIPTION_REMINDER_FOLLOW_UP",
  SubscriptionActivated = "SUBSCRIPTION_SUCCESSFULLY_PAID",
  SubscriptionPaymentFailed = "SUBSCRIPTION_FAILD_PAID",
}

export type NotificationPayload = Record<string, string>;

export function jalaliDate(value: string | Date, timezone = "Asia/Tehran") {
  return new Intl.DateTimeFormat("fa-IR-u-ca-persian", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(typeof value === "string" ? `${value}T12:00:00Z` : value));
}

export function displayOrderNumber(id: string) { return id.slice(0, 8).toUpperCase(); }
export function displayToman(value: string) { return BigInt(value).toLocaleString("fa-IR"); }
