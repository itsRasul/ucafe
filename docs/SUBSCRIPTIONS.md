# Subscriptions and plan features

## Model

- `subscription_plans`: fixed-key catalog with editable description, rank, price, billing months, status, trial/grace days, highlights, and JSON feature values.
- `subscriptions`: one current lifecycle projection per cafe, including paid-through, pending change, and optimistic version.
- `subscription_periods`: authoritative paid-entitlement schedule with plan/price/billing snapshots and funding payment.
- `subscription_payments`: immutable financial-operation, pricing, period, and provider/manual snapshots.
- `payment_intents`: immutable checkout/invoice snapshots; see [PAYMENTS.md](PAYMENTS.md).

Migration defaults are Silver 1,900,000 toman and Golden 2,900,000 toman, both with seven trial/grace days. The ordering migration activates Golden, seeds Silver with reservations on/ordering off, and Golden with both on. Platform operators can later change name, price, status, trial/grace lengths, and module flags; never treat seed or a local database's current values as permanent policy.

## Feature gates

Known plan features are `menu`, `reservations`, and `onlineOrdering`. Their Persian labels, types, order, and enforcement semantics live in one registry. Platform edits preserve unknown legacy JSON keys. A module is enabled only when:

1. the subscription effective status is `TRIALING`, `ACTIVE`, or `GRACE`; and
2. the current plan feature value is `true`.

Services enforce these checks server-side. Menu remains part of the plan model but public availability is also controlled by tenant lifecycle.

## Lifecycle

```text
explicit start -> TRIALING -> SUSPENDED (trial expires unpaid)
                         \
                          verified/manual payment -> ACTIVE -> GRACE -> SUSPENDED
                                                     ^                  |
                                                     +-- payment -------+
```

- A platform operator explicitly starts a trial on an active plan; only one subscription may exist per cafe.
- Trial entitlement ends at `trial_ends_at` and receives no paid grace assumption.
- A prepaid period lasts `billing_months` calendar months, clamping end-of-month dates.
- Trial conversion starts immediately at payment verification. Active/grace renewal appends from `paid_through_at`; post-grace reactivation starts at verification.
- Upgrades activate immediately, keep the paid-through boundary, rewrite remaining period entitlements, and charge exact-duration proration. Downgrades remain pending until paid-through and can be changed or canceled.
- After a paid period ends, grace lasts the plan's configured `grace_days`; after that, the subscription and cafe suspend.
- `CANCELED` is terminal for effective-status calculation.
- Reconciliation updates both subscription and `coffee_shops.status`. Public context triggers reconciliation when stored/effective state differs; platform operators can also request reconciliation.
- Successful manual or verified provider payment records a paid snapshot, sets `ACTIVE`, clears grace/suspension, and publishes an unpublished cafe.

## APIs and authority

- Platform `subscriptions.manage`: list/edit plans; read tenant summary; start trial; record manual prepaid payment; reconcile lifecycle.
- Tenant `subscription.read`: view a reconciled summary, active-plan catalog/virtual trial card, authoritative previews, and scoped invoices.
- Tenant `subscription.checkout`: create checkout and schedule/change/cancel a pending downgrade.
- Platform manual payments require an idempotency key and use the same action/pricing engine as gateway settlement.

## Concurrency and snapshots

Lifecycle mutations use one per-cafe PostgreSQL advisory transaction lock. Subscription version and plan timestamp reject stale previews. One live intent per cafe, unique intent linkage, idempotency keys, and provider-reference uniqueness enforce exactly-once settlement.

## Notifications

Owners receive deduplicated reminders three, two, and one day before paid-through, on the last day, at expiration, and three days after expiration, plus successful-payment and failed-verification events. Scheduled delivery rechecks paid-through before sending.

