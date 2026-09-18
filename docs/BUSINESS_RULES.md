# Business rules

Critical rules are summarized here. Domain documents contain the corresponding lifecycle detail.

## Invariants

- A tenant-owned resource must never be read or mutated by resource ID alone when tenant scope is required.
- Tenant identity comes from a resolved active hostname or an authenticated internal proxy override, never arbitrary request input.
- Administrative `users` and cafe `clients` are separate. A client is owned by exactly one cafe and `(coffee_shop_id, phone)` is unique.
- Frontend visibility is not authorization. Guards, scoped queries, and database constraints remain authoritative.
- Public/client projections omit phone values; protected tenant operations may expose client phone only where the workflow requires it.

## Menu and ordering

- A public menu includes active categories; availability remains explicit on items/variants.
- An item needs either a base price or at least one variant. Variant names are unique per item and at most one variant is default.
- Checkout requires an authenticated client and an enabled `onlineOrdering` plan feature.
- The server merges duplicate cart lines, limits each line to 1–20 units and the cart to 50 units, rechecks tenant/category/item/variant ownership and availability, and recalculates all totals in toman.
- A courier order requires an existing tenant/client-owned address or a validated new address. Pickup stores no delivery address.
- Only `OFFLINE` payment exists for customer orders. Subscription gateway payments are a separate domain.
- `(coffee_shop_id, client_id, idempotency_key)` makes repeated checkout creation return the existing order.
- Order transitions are defined in [ORDERING.md](ORDERING.md); terminal states cannot transition.

## Reservations

- Reservations require the plan's `reservations` feature and an active primary branch.
- Slots are generated only from same-day opening ranges, must finish before closing, honor lead/advance/party bounds, and count overlapping `PENDING` plus `CONFIRMED` guests.
- Creation serializes on a PostgreSQL advisory transaction lock for branch/date and rechecks capacity.
- Client creation produces `PENDING`; staff creation produces `CONFIRMED` and records the acting administrative user.
- Staff may create a tenant client without OTP when booking at the counter; a name is mandatory for a new phone and `phone_verified_at` remains null until real client authentication.
- Only pending/confirmed reservations can be edited. Status transitions are defined in [RESERVATIONS.md](RESERVATIONS.md).

## Plans and subscriptions

- Plan price, status, trial/grace lengths, and module flags are mutable platform-managed data. Payment/subscription records snapshot relevant plan and amount values.
- Feature access requires both an entitled effective subscription status (`TRIALING`, `ACTIVE`, or `GRACE`) and a true plan feature flag.
- Trial expiry suspends immediately. A paid period moves to grace for the plan's configured duration, then suspends.
- Prepaid renewal begins after the latest of now, current paid end, or an active trial end and adds the plan's calendar-month duration.
- Suspension does not delete tenant data. Successful payment/reactivation clears suspension and publishes the cafe when necessary.

## Renewal invoices and payments

- `payment_intents` are the renewal invoice model; there is no separate invoice ledger.
- The owner checkout DTO currently accepts only `silver`, even if other plans are active.
- Intent amount/name/key are immutable snapshots. Gateway amounts are derived server-side and converted from toman to rial.
- Checkout is idempotent per tenant/key. Callback lookup requires the opaque intent ID and matching authority.
- Only successful server-side verification records a prepaid period. Duplicate callbacks or provider references cannot double-credit.

## Notifications

- Business writes enqueue an encrypted outbox record in the same database transaction where applicable; they do not wait for sms.ir.
- A stable unique deduplication key prevents repeated event/callback/scheduled sends.
- Delivery retries at most three times with exponential backoff; stale processing claims reset after five minutes.
- Reservation/subscription scheduled jobs recheck current eligibility before sending.
- Owner alerts for new orders/reservations are opt-in settings. OTP delivery is direct through the auth provider, not the notification outbox.

## Unresolved product rule

- There is no confirmed client self-cancellation policy or endpoint for reservations.

