# ADR-008: Tenant CRM Feedback owns customer responses and a small recovery state

- **Status:** Implemented in Phase 6; authenticated visual acceptance pending.
- **Date:** 2026-09-29

## Context

Phase 6 needs a tenant-isolated place for a café to record satisfaction and complete lightweight service recovery. Client, Orders, Reservations, and Phase 3 Reminders already own identity, source lifecycle, and future follow-up. UCafe has no existing Review Request system or general tenant event bus. A generic case/ticket model would duplicate those domains and exceed the requested workflow.

## Decision

Keep `Client` as customer identity and store responses in `tenant_crm_feedback`. Require a 1–5 rating; allow an optional customer comment. Support only existing entry channels: staff `MANUAL` and authenticated `CUSTOMER_PANEL`. Customer submissions may reference exactly one same-tenant, same-Client `DELIVERED` Order or `COMPLETED` Reservation. Allow at most one response per linked source using partial unique indexes and composite foreign keys.

Treat rating 1–2 as negative and initialize it to `NEEDS_ATTENTION`; ratings 3–5 start as `NEW`. Store `RESOLVED`, resolver, timestamp, and optional internal note on the Feedback row. Resolve under a row lock, preserve the first resolution on retry, and do not reopen. Use the existing Reminder for follow-up, with a short Feedback ID in its description. Customer endpoints return only that authenticated Client's rating, comment, source, and creation time.

Customer 360 summary/recent records and Timeline events are bounded query projections over the authoritative Feedback row. Timeline has received/resolved events but no status-history persistence or event publisher.

## Alternatives considered

- A Feedback case, thread, or ticket table: rejected because recovery has one internal resolution and already has a Reminder for future work.
- Multiple customer submissions per Order/Reservation: rejected because the current detail flow presents one response per completed source; manual verbal feedback remains unlinked and can be recorded distinctly.
- Optional rating or comment-only submissions: rejected because the customer UI and operational summary need one uniform bounded scale; a required rating prevents empty/ambiguous records.
- Review Request source and invitation workflow: deferred because no existing request infrastructure was found and Phase 6 covers the response itself.
- Automatic Loyalty, Offer, Campaign, or SMS actions: deferred to their later phase and consent/eligibility contracts.

## Consequences

Feedback remains small and distinct from support, messaging, Offers, Loyalty, and Platform CRM. Customer comments and recovery notes remain private. Unique source links turn duplicate submissions into conflicts rather than duplicate records; a customer can inspect their prior response but cannot edit it. The current model has no correction, archive, reopen, status-transition history, or separate retention workflow. Negative threshold and one-response-per-source semantics require an explicit future change if product intent changes.

See [FEEDBACK.md](FEEDBACK.md), DATA_MODEL.md, MULTI_TENANCY.md, INTEGRATIONS.md, API.md, EVENTS.md, PRIVACY.md, and TESTING.md.
