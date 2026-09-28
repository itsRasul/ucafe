# ADR-007: Tenant CRM Loyalty uses a signed ledger and durable Order outbox

- **Status:** Implemented in Phase 5; authenticated UI acceptance pending.
- **Date:** 2026-09-29

## Context

Phase 5 needs tenant-local customer points, repeat-safe earning, safe concurrent debits, and Order integration that cannot make Order success depend on optional CRM behavior. The current Order stores only current status and payable amount; `DELIVERED` is terminal and there is no refund flow. Existing Notification and Platform CRM outboxes have domain-specific contracts and are not suitable Loyalty event definitions.

## Decision

Keep `Client` as identity. Each café configures versioned `spend_per_point_toman`; delivered earning is `floor(total_amount_toman / spend_per_point_toman)` in integer arithmetic. The configuration version effective at the persisted event timestamp supplies the rate snapshot.

Persist signed bigint point movements in `tenant_crm_loyalty_ledger` and derive balance by summing the rows. Create an account lazily; lock its tenant/Client row before any debit or earning mutation. A partial unique index allows one EARN per café/Order, and tenant-scoped idempotency keys protect staff adjustments/redemptions. Create the Redemption and corresponding negative ledger row in one transaction with immutable display/cost snapshots.

When an Order becomes Delivered, Orders inserts a small `tenant.order.delivered` record in `domain_event_outbox` in the same transaction. Orders does not call Tenant CRM. A CRM-owned API poller claims durable rows using PostgreSQL `SKIP LOCKED`, applies bounded retries/stale recovery, checks current `tenant_crm` entitlement, and writes points transactionally. This outbox is not a general event bus and does not reuse Platform CRM Workflow.

## Alternatives considered

- A mutable points column on Client: rejected because it cannot explain or rebuild a balance.
- Synchronous Order-to-Loyalty service calls: rejected because optional CRM errors would share the Order success path.
- Reusing Platform CRM Workflow or Notification outbox semantics: rejected because their event ownership/payload contracts are unrelated.
- A broker, worker service, or cached balance: rejected without measured volume or an existing generic infrastructure contract.
- Discount/checkout-backed Rewards: deferred; Phase 5 redemption records staff fulfillment only.

## Consequences

The ledger remains the accounting source of truth. Idempotency is enforced in PostgreSQL, and account locking serializes simultaneous redemptions/manual debits. Order delivery commits even if Loyalty is disabled or its consumer is unavailable; the outbox survives process restarts. A bounded poller adds periodic API database reads and exhausted events require operational inspection/replay; no Loyalty operations dashboard exists. Refund reversals and expiry must be defined if those source/business rules are added. No points balance, audience, or analytics cache is maintained.

See LOYALTY.md, DATA_MODEL.md, INTEGRATIONS.md, EVENTS.md, MULTI_TENANCY.md, API.md, and TESTING.md.
