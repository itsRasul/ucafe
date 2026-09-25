# Database

PostgreSQL 17 is the business system of record. TypeORM entities describe the application mapping; ordered migrations describe deployed schema history. `synchronize` and automatic migration execution are disabled.

## Entity areas

- tenancy/content: `coffee_shops`, `branches`, `domains`, `website_settings`, `branch_opening_hours`, `media_assets`
- administrative identity/RBAC: `users`, memberships, roles, permissions, assignments, `auth_sessions`, OTP challenges
- clients: `clients`, `client_auth_sessions`, `client_addresses`
- catalog/commerce: menu categories/items/variants, promotions/targets, ordering settings, orders/items
- reservations: settings and reservations
- subscriptions/payments: plans, subscription lifecycle projections, entitlement periods, subscription payments, payment intents
- operations: notification deliveries, platform audit events, platform consultation requests

The code, entities, and migrations—not this overview—are the column-level schema source of truth.

## Ownership and relationships

Most business rows carry `coffee_shop_id`; inherited rows such as opening hours and subscription payments derive tenant through a parent. Security-critical joins are scoped in services and, where practical, reinforced with trigger functions that reject tenant mismatches.

Examples include role assignment, menu item/variant/category, reservation branch/client, media/menu item, payment intent/plan, client address/session, order client/branch/address, and order item/menu/variant relationships.

## Important constraints

- unique cafe slug and global hostname; one active primary branch/domain per cafe
- one membership per tenant/user and scope-compatible RBAC assignments
- normalized phone checks; one client phone per tenant
- one subscription per cafe; paired pending-plan fields; valid entitlement ranges; unique payment-intent/provider references
- tenant/client order idempotency, tenant checkout idempotency, manual-payment idempotency, and at most one live checkout per tenant
- positive/nonnegative plan, menu, order, promotion reward/target, capacity, interval, and image metadata checks
- one active logo/hero and menu-item image slot; gallery/key/focal/order constraints
- globally unique notification deduplication key
- `(coffee_shop_id, status, status_changed_at)` index for tenant outcome-time analytics

Soft deletion is used for cafes/domains/branches/users/menu/category/items/client addresses/media where defined. Historical orders, order items, reservations, subscription payments, intents, and audit events are retained rather than soft-deleted through current product APIs.

## Money

Money is integer toman in `bigint`/`numeric` columns and represented as strings at TypeScript persistence/response boundaries where precision matters. Payment/order rows snapshot names and amounts; order totals preserve gross subtotal, discounts, and net payable value. Rial conversion exists only in the gateway adapter/service boundary.

## Date and time

- Lifecycle/session/audit timestamps use `timestamptz`.
- Reservation day uses PostgreSQL `date`; start/end use `time` and are interpreted in branch timezone (default `Asia/Tehran`).
- UI Jalali dates convert to Gregorian ISO before the API.
- Entitlement periods use canonical UTC timestamps. Prepaid billing adds UTC calendar months and clamps month ends; proration uses exact timestamp duration and integer half-up toman rounding.

## Locking and atomicity

Advisory transaction locks serialize reservation capacity, subscription/checkout, order idempotency, and selected identity creation keys. Pessimistic row locks serialize mutable reservation/order/payment states. Unique constraints provide the final idempotency boundary.

## Migrations

Create a new TypeORM migration for every schema/data-contract change; never rewrite an applied migration to repair production state. Run `migration:show`, apply against PostgreSQL, verify expected constraints/data, and test the corresponding domain. Production migration execution must be a single controlled release job even though the current production API image also runs migrations on startup.

