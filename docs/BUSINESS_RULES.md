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
- Product/category promotions overlay base or variant prices; the largest per-unit saving wins, with priority and promotion ID as deterministic tie-breakers. Order totals and line snapshots preserve original price, discount, and payable price.
- An authenticated client may apply one tenant-scoped coupon. The order-stage reward follows item pricing and compares its minimum against the discounted item subtotal. A percentage cap and zero floor protect the final amount; offline order creation consumes usage, while cancellation under review releases it.
- Customer promotion eligibility is evaluated from the authenticated, tenant-owned client. Qualifying history is `DELIVERED` orders, using their stored net `total_amount_toman` and `status_changed_at`; non-delivered orders do not contribute. A first-order promotion also reserves eligibility while its redemption is applied, serializes same-customer checkouts, and releases the reservation if an under-review order is canceled.
- Customer conditions on one promotion are ANDed. Manual segment membership and segment-targeted promotions are tenant-scoped; inactive or archived segments fail eligibility and cannot broaden a promotion. Customer groups belong to the Clients domain; Promotions does not depend on CRM or Analytics.
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

- Plan description, price, billing length, status, rank, trial/grace lengths, highlights, and registered features are mutable platform-managed data. Rank alone classifies upgrades and downgrades.
- Feature access requires both an entitled effective subscription status (`TRIALING`, `ACTIVE`, or `GRACE`) and a true plan feature flag.
- Trial expiry suspends immediately. A paid period moves to grace for the plan's configured duration, then suspends.
- Trial conversion and post-grace reactivation begin at verified payment time. Active and grace renewal begin at the previous `paid_through_at`; a grace-created intent keeps that anchor until its 15-minute expiry.
- An upgrade takes effect at verification, keeps `paid_through_at`, updates remaining entitlement periods, and charges timestamp-prorated target cost less source credit with half-up whole-toman rounding.
- A downgrade is one replaceable pending change effective at `paid_through_at`; renewal while pending charges and schedules the target plan.
- Suspension does not delete tenant data. Successful payment/reactivation clears suspension and publishes the cafe when necessary.

## Renewal invoices and payments

- `payment_intents` are the renewal invoice model; there is no separate invoice ledger.
- Preview accepts only a plan key. Checkout accepts the plan key, tenant idempotency key, expected subscription version, and expected plan timestamp; it re-locks and recalculates before creating an invoice.
- Intent operation, source/target plans, pricing, effective timing, and entitlement anchors are immutable snapshots. Gateway amounts are derived server-side and converted from toman to rial.
- Only one unexpired pending/verifying intent may exist per tenant. Callback lookup requires the opaque intent ID and matching authority.
- Only successful server-side verification mutates entitlement. Unique payment-intent and provider references prevent duplicate callbacks from double-crediting.

## Notifications

- Business writes enqueue an encrypted outbox record in the same database transaction where applicable; they do not wait for sms.ir.
- A stable unique deduplication key prevents repeated event/callback/scheduled sends.
- Delivery retries at most three times with exponential backoff; stale processing claims reset after five minutes.
- Reservation/subscription scheduled jobs recheck current eligibility before sending.
- Owner alerts for new orders/reservations are opt-in settings. OTP delivery is direct through the auth provider, not the notification outbox.

## Platform CRM boundary

- Platform CRM is an internal platform domain. It is not tenant-owned and does not manage a café's Clients or customer segments.
- CRM Organizations, Contacts, Leads, and Deals are distinct from Tenant, User, and Client records. Deals remain distinct from Subscription, Trial, invoice/payment intent, and Payment records.
- One CRM Organization may link to at most one non-deleted Tenant, and each Tenant may link to at most one Organization. Link/unlink is explicit, separately permissioned, and transactionally audited; it is read-only with respect to Tenant lifecycle.
- Contact and Lead phone/email are encrypted at rest and omitted from list, duplicate, and audit projections; authorized single-record detail may reveal them.
- Exact Organization and Contact duplicate candidates are review warnings only. CRM does not auto-merge or block an operator from continuing.
- Lead duplicate candidates return explicit conflicts; an operator must link an existing record or confirm a separate Lead/Organization/Contact.
- Archiving an Organization does not archive Contacts. CRM has no hard-delete route, and parent/child references do not cascade-delete.
- CRM may read limited source-domain projections and link to their owner module. It must not duplicate Tenant or Subscription lifecycle, provisioning, pricing, payment, or verification rules. Current Subscription status is projected without reconciliation; Timeline may show only durable Tenant creation/link, Trial-start, and successful paid-operation facts, never fabricated lifecycle transitions or payment amounts/provider references.
- platform_order_requests remains public consultation intake. Each accepted public consultation request transactionally creates one linked LANDING_FORM Lead; old requests are not backfilled. CRM status is a separate sales lifecycle and must not translate the existing CLOSED request status into Deal WON/LOST.
- Lead status transitions append history atomically. Qualification is explicit; unqualification requires a controlled reason. Conversion is allowed from QUALIFIED and atomically resolves an Organization and Contact; it creates no Deal. Phase 3 permits a separate explicit Deal from a converted Lead, at most one per Lead.
- CRM Deals use the fixed `ucafe-default` pipeline; stage is distinct from OPEN/WON/LOST outcome. Stage history and PII-free audit records commit with every stage/outcome write. Closed Deals cannot be reopened through normal operations.
- Deal estimated amount is an optional integer Toman forecast; it is never recognized revenue. Expected Plan is a read-only catalog reference. Deal create/win/loss never changes Tenant, Trial, Subscription, invoice, or Payment state.
- Activities record past interactions, Tasks record future work, and Notes hold plain-text internal context. A work record must link to at least one CRM record; all linked records must share one Organization. A Lead-only work record may exist before conversion and appears under its Organization after conversion.
- `FOLLOW_UP` is a Task kind. Overdue is derived from an OPEN Task's due time; completing a Task does not create an Activity. OPEN Tasks must be completed or canceled before archive.
- CRM work mutations and their audit rows are transactional; audit summaries omit user-authored Activity, Task, and Note text. Workflow actions may create CRM Tasks/Tag/owner changes only through validated transactional CRM operations; no communication reminder is sent.
- Phase 9 writes selected CRM triggers to its own transactional outbox. UCafe still has no Sales Engine or general domain-event bus. Notification delivery records are not integration events.
- Workflow conditions reuse the bounded Phase 7 filter AST; actions are allowlisted, retries are bounded, and correlation/depth stop automation loops. Workflows cannot mutate Tenant, Trial, Subscription, Plan, or Payment state.

See [docs/crm/README.md](crm/README.md) for the implemented scope and future source-of-truth rules.

## Unresolved product rule

- There is no confirmed client self-cancellation policy or endpoint for reservations.

