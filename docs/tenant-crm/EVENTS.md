# Tenant CRM events

## What exists

Phase 1 adds no Client lifecycle event. The directory is read-only and does not change OTP, reservation, Order, or Client lifecycle transactions.

UCafe has no general domain event bus. notification_deliveries is an encrypted SMS delivery outbox, not a cross-module event contract. Platform CRM has a distinct crm_workflow_events outbox for selected platform CRM triggers. Neither mechanism makes Tenant CRM events exist.

Current Client, Order, Reservation, Discount, and Subscription records remain authoritative in their source tables. Their current changes are not a public integration event contract. The worker app is a scaffold; notification and Platform CRM processors run in the API.

## Future candidates, not implemented

Potential Tenant CRM triggers include client.created, order.completed, reservation.completed, reservation.no_show, feedback.created, loyalty.points_earned, and campaign.sent. Before publishing any trigger, define the authoritative source, transaction boundary, stable deduplication key, minimal PII-safe payload, actor/source metadata, versioning, retries, and replay behavior.

Any future tenant CRM asynchronous record carries authoritative coffeeShopId and subject IDs. Consumers revalidate tenant relationships and load authorized source projections. Never include phone, OTP, notes, or full customer details in event envelopes.

## Workflow boundary

Future Tenant CRM automation owns its triggers, conditions, actions, and business meaning. It may reuse a truly generic outbox claim/retry primitive after review, but it does not reuse Platform CRM workflow definitions, filters, actions, or event semantics. No campaigns or automation are Phase 0 work.
