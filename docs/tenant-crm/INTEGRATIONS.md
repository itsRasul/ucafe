# Tenant CRM integrations

## Source-of-truth matrix

| Domain | Current authority | Tenant CRM relationship |
| --- | --- | --- |
| Tenant context | Host/domain and tenant middleware | Supplies authoritative coffeeShopId |
| Users and permissions | Identity, memberships, authorization | User is operator/actor; no new RBAC system |
| Client identity | clients and ClientAuthService | Customer identity; directory and Customer 360 read it |
| Orders | orders, order_items, ordering service | Phase 2 read-only CRM projection and aggregates; no duplicate order storage |
| Reservations | reservations and reservation service | Phase 2 read-only CRM projection and aggregates; no duplicate booking logic |
| Discounts | promotions, coupons, redemptions and manual customer segments | Later CRM may choose audiences; Discounts owns definitions, eligibility, redemption and limits |
| Tenant Analytics | analytics module | Already owns delivered-order customer metrics; coordinate definitions and avoid duplicate reports |
| Plans | subscription_plans JSON features, SubscriptionsService | tenant_crm uses effective feature entitlement; Golden defaults on |
| SMS/notifications | SmsProvider and encrypted notification_deliveries outbox | Future campaigns require separate consent, recipient, cost, delivery, and retry design |
| Platform CRM | Platform-scoped crm_* domain | No shared customer records or cross-CRM relations |
| Audit | platform_audit_events | Platform-only audit; do not use for tenant customer actions |

## Orders

Orders are required to have a tenant-owned Client and are authoritative for statuses, delivered outcome timestamp, amounts, and frozen line/promotion snapshots. `OrderStatus.Delivered` is `DELIVERED`, the canonical successfully fulfilled terminal state (`COMPLETED_ORDER_STATUS`); `CANCELED` is unsuccessful and other states are nonterminal. Phase 2 counts every current Order as tracked and sums `total_amount_toman` only where current status is `DELIVERED`. The field is the stored final payable amount in integer toman after recorded item/order discounts (`subtotal_before_discount_toman - discount_total_toman`); it is not collected/settled cash. Customer payment is offline only, with no refund, tax, or delivery-fee ledger, and external/POS sales are not necessarily recorded. CRM reads this existing field without redefining Order financial semantics. Tenant Analytics continues to use delivered `status_changed_at` in café-local report periods.

## Reservations

Reservations are required to have a tenant Client and remain authoritative for dates, party size, customer/staff notes, status, and latest status actor/time. CRM reads current-state counts (including explicit `NO_SHOW`) and bounded recent fields; it does not infer a no-show from elapsed schedule time or alter booking capacity/transitions. Orders/Reservations have no complete status history: `status_changed_at` retains only the latest transition timestamp. CRM's Timeline therefore reconstructs creation and latest-status activity only, not an immutable lifecycle log. Reservations are not linked to Orders today. Neither source module depends on Tenant CRM or its entitlement.

## Discounts and customer segments

Promotions consumes tenant-owned Clients, delivered order history, and manual customer segment membership. Those segments are currently owned by the Clients/Promotions behavior and are not Platform CRM Segments. CRM Phase 4 smart groups must not silently replace or migrate them. Define how static and dynamic audiences interact before offering CRM segments to promotions. Existing customer search remains under current orders/menu permissions and is never gated by tenant_crm.

## Analytics

Tenant Analytics already provides delivered-order customer metrics and customer rankings under analytics permission plus the analytics feature. CRM customer panels may compose or link to these measures after deciding their UX, but must preserve the same delivered and café-time semantics. CRM Analytics cannot claim total spend if offline/POS events are missing.

## SMS and durable processing

OTP sends directly through the configured SMS provider. Transactional notifications use an encrypted, deduplicated outbox with bounded retries, currently dispatched in the API process. Neither is a campaign consent model or general event bus. Platform CRM's workflow outbox is not reusable business workflow logic. Reuse any runtime primitive only after confirming it is domain-neutral and supports tenant identity, privacy, idempotency, and isolation.

## Subscription feature contract

Phase 1 registers tenant_crm as a boolean feature in the existing catalog and plan-update input so the current Platform Admin plan editor can change it on any plan. Tenant Admin access exposes its effective state for navigation. Golden defaults on; other plans default off. All CRM APIs use the existing effective subscription resolver. Feature access and tenant RBAC are separate checks. Later subfeatures are not split into flags until packaging needs justify it.

**Phase 3 CRM-owned records.**

Phase 3 persists only staff-entered preferences and CRM records. Customer 360's Orders, Reservations, spend, counts, and activity remain query-time projections of their source domains. Notes and CRM fields do not enter client self-service APIs. Reminders are manual records only: there is no scheduler, notification integration, or automated action.

## Phase 4 Segmentation reads

Segments read current tenant Clients, the CRM profile's explicit seating/drink/birthday preferences, active tenant Tags and assignments, active typed Custom Field definitions/options/values, current Orders, and current Reservations. Each source module remains authoritative; Segmentation writes no source-domain data. Order and Reservation aggregates reuse Phase 2's current-state definitions, including delivered-only Known UCafe Spend and explicit NO_SHOW status.

Smart Groups are fixed criteria presets over those same sources and use the Segment compiler. Segment membership is not integrated with Promotions' manual customer groups, and Promotions authorization/entitlement is unchanged. Segment criteria and membership are never sent to Client self-service, Platform CRM, notification providers, or background jobs. Future Campaign integration is deferred until a separate contract covers consent, eligibility, membership snapshots, and delivery.

## Phase 5 Loyalty and Orders

The Orders status transaction records a durable `tenant.order.delivered` outbox row when an Order becomes `DELIVERED`; Orders has no Tenant CRM service dependency. The CRM processor reads the tenant-scoped Order's existing `total_amount_toman`, current Client status, effective CRM entitlement, and the program version effective at the event timestamp. It inserts one EARN ledger row at most per café/Order. The amount is the same stored payable amount used by Phase 2 Known UCafe Spend; it is not collected-cash evidence. Current Orders has no refund flow, and Delivered is terminal.

Redemption is a staff action in Tenant CRM. It records a Redemption snapshot and matching ledger debit in one transaction. It does not issue or apply a Discount, create an Order, or change Promotion eligibility. Loyalty does not alter Phase 4 Segment criteria or source metrics. No analytics read model or Client-facing integration is added.
