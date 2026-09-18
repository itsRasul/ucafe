# Subscriptions and plan features

## Model

- `subscription_plans`: editable catalog values—key, name, status, price in toman, billing months, trial days, grace days, and JSON feature flags.
- `subscriptions`: one lifecycle record per cafe.
- `subscription_payments`: immutable paid-period snapshots and provider/manual references.
- `payment_intents`: on-demand renewal checkout/invoice snapshots; see [PAYMENTS.md](PAYMENTS.md).

Migration defaults are Silver 1,900,000 toman and Golden 2,900,000 toman, both with seven trial/grace days. The ordering migration activates Golden, seeds Silver with reservations on/ordering off, and Golden with both on. Platform operators can later change name, price, status, trial/grace lengths, and module flags; never treat seed or a local database's current values as permanent policy.

## Feature gates

Known plan features are `menu`, `reservations`, and `onlineOrdering`. Platform plan edits expose the two module flags while preserving other feature keys. A module is enabled only when:

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
- Renewal starts at the latest of now, current period end, or active trial end so prepaid time is not lost.
- After a paid period ends, grace lasts the plan's configured `grace_days`; after that, the subscription and cafe suspend.
- `CANCELED` is terminal for effective-status calculation.
- Reconciliation updates both subscription and `coffee_shops.status`. Public context triggers reconciliation when stored/effective state differs; platform operators can also request reconciliation.
- Successful manual or verified provider payment records a paid snapshot, sets `ACTIVE`, clears grace/suspension, and publishes an unpublished cafe.

## APIs and authority

- Platform `subscriptions.manage`: list/edit plans; read tenant summary; start trial; record manual prepaid payment; reconcile lifecycle.
- Tenant `subscription.read`: view safe subscription summary and renewal warnings.
- Tenant `subscription.checkout`: create renewal checkout; `subscription.read`: list/read invoice/payment intents.

The checkout DTO currently accepts only plan key `silver`, even though plan records and features support Golden. This is an explicit current contract, not inferred from plan status.

## Concurrency and snapshots

Trial, payment, and checkout creation use PostgreSQL advisory transaction locks. `subscription_payments` retain amount, plan key/name, period, provider, reference, and paid time. Unique provider/reference prevents the same gateway event from crediting twice.

## Notifications

Owners receive deduplicated reminders three, two, and one day before period end, on the last day, at expiration, and three days after expiration, plus activation and failed-verification events. Scheduled delivery rechecks the current paid-period identity before sending.

