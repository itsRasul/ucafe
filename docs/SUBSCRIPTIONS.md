# Subscriptions and plan features

## Model

- `subscription_plans`: fixed-key catalog with editable description, rank, price, billing months, status, trial/grace days, highlights, and JSON functional entitlement values.
- `plan_display_feature_definitions` / `plan_display_feature_values`: shared labels and ordering with a text value per plan. They are marketing/comparison data and do not participate in entitlement evaluation.
- `subscriptions`: one current lifecycle projection per cafe, including paid-through, pending change, and optimistic version.
- `subscription_periods`: authoritative paid-entitlement schedule with plan/price/billing snapshots and funding payment.
- `subscription_payments`: immutable financial-operation, pricing, period, and provider/manual snapshots.
- `payment_intents`: immutable checkout/invoice snapshots; see [PAYMENTS.md](PAYMENTS.md).

Bronze is introduced at 537,000 toman per one-month billing period, with menu and reservations. The existing Silver and Golden rows and IDs are retained. `billing_months` records the price period (currently one month unless an operator changes it). A forward migration aligns the canonical functional feature defaults while preserving unrelated JSON keys; later Platform Admin assignment changes remain dynamic. These seed values are defaults, not permanent commercial constants.

## Feature gates

Current registered plan features are `menu`, `reservations`, `onlineOrdering`, `analytics`, `tenant_crm`, and `inventory`. Their Persian labels, types, order, and enforcement semantics live in one registry. Feature values are administrator-editable; defaults do not create plan-name access rules. Platform edits preserve unknown legacy JSON keys. Bronze defaults to menu and reservations; Silver adds online ordering and analytics; Golden adds tenant CRM and inventory. A module is enabled only when:

1. the subscription effective status is `TRIALING`, `ACTIVE`, or `GRACE`; and
2. the effective entitlement plan feature value is `true`. Active trials resolve the current Golden feature configuration through `SubscriptionsService.entitlementState`; the stored plan remains the intended paid plan. Paid access uses its paid plan.

Services enforce these checks server-side. Menu remains part of the plan model but public availability is also controlled by tenant lifecycle.

Platform Admin manages display-feature definitions separately from functional assignment: definitions have a stable key, unique normalized label, and shared sort order; each plan may store one bounded text value for a definition. Editing a definition updates every plan using it. Deleting a definition cascades its values. Display data is included in the public plan catalog and tenant plan catalog, but `entitlementState` reads only the registered functional JSON flags. Public/tenant cards take the first seven assigned functional features in registry order before adding ordered display features; comparison rows include the full functional catalog and one row per shared display definition used by any shown plan.

## Lifecycle

```text
explicit start -> TRIALING -> SUSPENDED (trial expires unpaid)
                         \
                          verified/manual payment -> ACTIVE -> GRACE -> SUSPENDED
                                                     ^                  |
                                                     +-- payment -------+
```

- A platform operator explicitly starts a 30-day trial on an active plan; only one subscription may exist per cafe. `trial-policy.ts` is the runtime source of truth, and plan updates reject other initial-trial durations. Golden must be active when a trial starts. Draft provisioning (Platform/CLI) still requires explicit trial start; public purchase still activates only on verified payment.
- Trial entitlement ends at `trial_ends_at` and receives no paid grace assumption.
- A prepaid period lasts `billing_months` calendar months, clamping end-of-month dates.
- Trial conversion starts immediately at payment verification. Active/grace renewal appends from `paid_through_at`; post-grace reactivation starts at verification.
- Upgrades activate immediately, keep the paid-through boundary, rewrite remaining period entitlements, and charge exact-duration proration. Downgrades remain pending until paid-through and can be changed or canceled.
- After a paid period ends, grace lasts the plan's configured `grace_days`; after that, the subscription and cafe suspend.
- `CANCELED` is terminal for effective-status calculation.
- Reconciliation updates both subscription and `coffee_shops.status`. Public context triggers reconciliation when stored/effective state differs; platform operators can also request reconciliation.
- Successful manual or verified provider payment records a paid snapshot, sets `ACTIVE`, clears grace/suspension, and publishes an unpublished cafe.

## APIs and authority

The public active-plan catalog and verified initial purchase reuse this plan registry, quote engine, and financial settlement. Purchase creates a DRAFT café without a subscription, then creates ACTIVE subscription access only on verified payment. It does not start a trial. See [PUBLIC_ACQUISITION.md](PUBLIC_ACQUISITION.md) for API, ownership and resume contracts.

- Platform `subscriptions.manage`: list/edit plans; read tenant summary; start trial; record manual prepaid payment; reconcile lifecycle.
- Platform `subscriptions.read`: read only the CRM customer-context projection and mixed Timeline. It omits amount, invoice intents, provider references, and payment details, and its reads never reconcile the Subscription or Tenant.
- Tenant `subscription.read`: view a reconciled summary, active-plan catalog/virtual trial card, authoritative previews, and scoped invoices.
- Tenant `subscription.checkout`: create checkout and schedule/change/cancel a pending downgrade.
- Platform manual payments require an idempotency key and use the same action/pricing engine as gateway settlement.

## Concurrency and snapshots

Lifecycle mutations use one per-cafe PostgreSQL advisory transaction lock. Subscription version and plan timestamp reject stale previews. One live intent per cafe, unique intent linkage, idempotency keys, and provider-reference uniqueness enforce exactly-once settlement.

## Notifications

Owners receive deduplicated reminders three, two, and one day before paid-through, on the last day, at expiration, and three days after expiration, plus successful-payment and failed-verification events. Scheduled delivery rechecks paid-through before sending. Trial events reuse the same outbox and owner policy: 7 days before, 2 days before, unpaid expiry, and 3 days after. Delivery rechecks trial boundary, paid entitlement, tenant availability, and the current active owner membership. See [NOTIFICATIONS.md](NOTIFICATIONS.md) for windows and provider limits.

## Trial compatibility and locks

New trials last 30 elapsed UTC days. Existing active and expired trial timestamps, paid periods, and paid grace are unchanged; no historical trials reopen. Existing active trials now receive configured Golden entitlements until their stored boundary. The forward migration changes catalog trial days/default only.

Tenant Admin access projects every registered feature and a subscription reason. Locked sections stay visible to authorized staff; navigation rechecks server entitlements and a shared native dialog links to `/admin/subscription`. API feature denials also open it, while access refreshes on window focus and every 30 seconds. Menu/site/promotions, Orders, and Reservations admin controllers use the reusable feature guard; Analytics, Inventory and CRM retain their service checks. Login, overview, subscription/invoices, support and staff remain independently permissioned. Public expiry retains the existing suspended-site response.

The public landing catalog is fetched from the read-only `/public/platform/plans` API during server rendering; that endpoint is `no-store`, and the web loader uses request-scoped React caching. Tenant Admin reads the protected `/tenant/subscription/plans` projection. Both pages use server-provided feature metadata and values; neither contains plan-specific feature arrays.

## Tenant CRM entitlement

Phase 1 registers tenant_crm as a boolean feature in the existing catalog and plan-update input; Platform Admin can toggle it for every plan. Tenant Admin access exposes its effective state. CRM APIs enforce it through SubscriptionsService.requireFeature and tenant authorization. Golden defaults enabled; other plans default disabled. Access never depends on plan name. Existing Promotions customer search and manual segments do not require tenant_crm.

