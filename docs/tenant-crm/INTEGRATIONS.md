# Tenant CRM integrations

## Source-of-truth matrix

| Domain | Current authority | Tenant CRM relationship |
| --- | --- | --- |
| Tenant context | Host/domain and tenant middleware | Supplies authoritative coffeeShopId |
| Users and permissions | Identity, memberships, authorization | User is operator/actor; no new RBAC system |
| Client identity | clients and ClientAuthService | Customer identity; Phase 1 directory reads it |
| Orders | orders, order_items, ordering service | Future read-only history and aggregates; no duplicate order storage |
| Reservations | reservations and reservation service | Future read-only timeline facts; no duplicate booking logic |
| Discounts | promotions, coupons, redemptions and manual customer segments | Later CRM may choose audiences; Discounts owns definitions, eligibility, redemption and limits |
| Tenant Analytics | analytics module | Already owns delivered-order customer metrics; coordinate definitions and avoid duplicate reports |
| Plans | subscription_plans JSON features, SubscriptionsService | tenant_crm uses effective feature entitlement; Golden defaults on |
| SMS/notifications | SmsProvider and encrypted notification_deliveries outbox | Future campaigns require separate consent, recipient, cost, delivery, and retry design |
| Platform CRM | Platform-scoped crm_* domain | No shared customer records or cross-CRM relations |
| Audit | platform_audit_events | Platform-only audit; do not use for tenant customer actions |

## Orders

Orders are required to have a tenant-owned Client and are authoritative for statuses, delivered outcome timestamp, amount and frozen line/promotion snapshots. CRM may later show tracked order count, delivered order count, Known UCafe Spend, average order value, last order, and item preferences from these sources. Current Analytics uses delivered Orders at status_changed_at and café-local periods. The amount is offline payable value, not proof of cash collection, and external POS transactions are not necessarily recorded.

## Reservations

Reservations are required to have a tenant Client and remain authoritative for dates, party size, customer/staff notes, status, and latest status actor/time. CRM may read history and derive completed/no-show counts, but must not alter booking capacity or transitions. Reservations are not linked to Orders today.

## Discounts and customer segments

Promotions consumes tenant-owned Clients, delivered order history, and manual customer segment membership. Those segments are currently owned by the Clients/Promotions behavior and are not Platform CRM Segments. CRM Phase 4 smart groups must not silently replace or migrate them. Define how static and dynamic audiences interact before offering CRM segments to promotions. Existing customer search remains under current orders/menu permissions and is never gated by tenant_crm.

## Analytics

Tenant Analytics already provides delivered-order customer metrics and customer rankings under analytics permission plus the analytics feature. CRM customer panels may compose or link to these measures after deciding their UX, but must preserve the same delivered and café-time semantics. CRM Analytics cannot claim total spend if offline/POS events are missing.

## SMS and durable processing

OTP sends directly through the configured SMS provider. Transactional notifications use an encrypted, deduplicated outbox with bounded retries, currently dispatched in the API process. Neither is a campaign consent model or general event bus. Platform CRM's workflow outbox is not reusable business workflow logic. Reuse any runtime primitive only after confirming it is domain-neutral and supports tenant identity, privacy, idempotency, and isolation.

## Subscription feature contract

Phase 1 registers tenant_crm as a boolean feature in the existing catalog and plan-update input so the current Platform Admin plan editor can change it on any plan. Tenant Admin access exposes its effective state for navigation. Golden defaults on; other plans default off. Both CRM routes use the existing effective subscription resolver. Feature access and tenant RBAC are separate checks. Later subfeatures are not split into flags until packaging needs justify it.
