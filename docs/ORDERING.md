# Ordering

## Purpose and scope

Online ordering is a tenant subscription module for authenticated cafe clients. It supports pickup/courier fulfillment and offline payment only; it does not charge customers online.

Relevant records are `online_ordering_settings`, `orders`, `order_items`, `clients`, `client_addresses`, and menu entities. Order/item and address snapshots preserve history when source data later changes.

## Public/client flow

1. `GET /public/ordering/settings` returns feature availability and enabled offline/delivery methods.
2. The cart stores menu item/variant selections in the web client.
3. Checkout requires a tenant-scoped client access token.
4. `POST /public/orders` accepts line IDs/quantities, delivery/payment choice, optional note, address data, and an idempotency key.
5. The service serializes duplicate client checkout keys, rechecks the feature and settings, resolves the primary branch and client, owns/creates a valid address, and recalculates lines and total. A submitted coupon code is validated under a coupon row lock; its promotion and redemption are included in the same transaction.
6. The order begins `UNDER_REVIEW`, immutable item/address snapshots are stored, and customer/optional-owner notifications are enqueued.
7. Clients list/read only orders matching both cafe and client ID through `/public/orders`.

The server rejects deleted/missing tenant items, inactive categories, unavailable items/variants, missing required variants, foreign addresses, unsupported delivery/payment choices, invalid quantities, and price-less items. The shared promotion pricing path recalculates product/category and order-stage discounts for quote and order creation. Client-submitted prices, discounts, promotion IDs, and totals do not exist in the DTO contract. See [DISCOUNTS.md](DISCOUNTS.md) for coupon consumption and cancellation rules.

## Admin flow and statuses

Tenant permissions `orders.read` and `orders.manage` protect list/detail, status, and settings APIs.

```text
UNDER_REVIEW -> PREPARING -> READY -> DELIVERED              (pickup)
      |             |          |
      +---------- CANCELED <----+

UNDER_REVIEW -> PREPARING -> READY -> OUT_FOR_DELIVERY -> DELIVERED (courier)
      |             |          |
      +---------- CANCELED <----+
```

Cancellation is not allowed after courier dispatch. `DELIVERED` and `CANCELED` are terminal. Status writes take a pessimistic lock, validate the transition, record time/acting admin, and enqueue the matching client notification.

## Settings

Defaults enable pickup, courier, and offline payment. Tenant managers may toggle them and the new-order owner alert, but settings changes require the online-ordering feature.

## Isolation and idempotency

- Unique order key: `(coffee_shop_id, client_id, idempotency_key)`.
- Every lookup includes `coffeeShopId`; client detail also includes `clientId`.
- Database triggers require order client/branch/address and order item/menu/variant tenants to match.
- Repeated notification events use stable outbox keys.

## Constraints

- Maximum 20 units per line and 50 units per cart.
- Current order currency is integer toman stored as `bigint`/string at JavaScript boundaries. Each order snapshots original item prices, discounts, net line totals, and promotion details.
- Taxes, delivery fees, online customer payment, refunds, and customer cancellation are not implemented.

