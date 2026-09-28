# Tenant CRM events

## What exists

Phase 1 added no Client lifecycle event. Phase 2 added source-domain activity projections and Phase 3 adds selected CRM-owned note/reminder projections, all query-time only; they do not publish events or change OTP, Reservation, Order, or Client lifecycle transactions.

UCafe has no general domain event bus. notification_deliveries is an encrypted SMS delivery outbox, not a cross-module event contract. Platform CRM has a distinct crm_workflow_events outbox for selected platform CRM triggers. Neither mechanism makes Tenant CRM events exist.

Current Client, Order, Reservation, Discount, and Subscription records remain authoritative in their source tables. Their current changes are not a public integration event contract. The worker app is a scaffold; notification and Platform CRM processors run in the API.

## Phase 2 reconstructed Timeline

The Timeline is a reconstructed CRM activity view, not an immutable lifecycle event log. It projects Client creation at `clients.created_at`; Order and Reservation creation at their `created_at`; and at most one current-status activity per source row at its latest `status_changed_at`. Orders and Reservations retain only the current status/latest transition timestamp, not transition history, so earlier transitions, actors, and their timestamps cannot be reconstructed and must not be fabricated. When creation and current status are the same moment, both distinct activities may appear.

Each event key combines a type-specific prefix, source UUID, and kind (`CREATED`, `COMPLETED`, or `STATUS:<current status>`), making it unique across projected event types and multiple activities for one source record. Pages sort by `(occurredAt DESC, eventKey DESC)` and the cursor uses the identical strict tuple predicate `<`; source queries remain tenant/client scoped. A bounded read is recomputed from live source rows on each request; keyset ordering is deterministic for an unchanged source set but does not promise a multi-page snapshot while source rows change. No Timeline table, outbox, cache, or general event infrastructure was added.

## Future candidates, not implemented

Potential Tenant CRM triggers include client.created, order.completed, reservation.completed, reservation.no_show, feedback.created, loyalty.points_earned, and campaign.sent. Before publishing any trigger, define the authoritative source, transaction boundary, stable deduplication key, minimal PII-safe payload, actor/source metadata, versioning, retries, and replay behavior.

Any future tenant CRM asynchronous record carries authoritative coffeeShopId and subject IDs. Consumers revalidate tenant relationships and load authorized source projections. Never include phone, OTP, notes, or full customer details in event envelopes.

## Workflow boundary

**Phase 3 timeline projection.**

The Timeline query now projects `NOTE_CREATED`, `REMINDER_CREATED`, and `REMINDER_COMPLETED` from persisted CRM rows. Note bodies are never included in Timeline metadata. Reminder completion appears only when its persisted status transitions to COMPLETED (using `completed_at`). These are query-time projection items, not a published event stream or complete audit history; edits, archives, cancellations, and prior status changes are not fabricated as events.

Future Tenant CRM automation owns its triggers, conditions, actions, and business meaning. It may reuse a truly generic outbox claim/retry primitive after review, but it does not reuse Platform CRM workflow definitions, filters, actions, or event semantics. No campaigns or automation are Phase 0 work.
