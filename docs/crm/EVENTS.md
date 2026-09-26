# Event catalog

## What exists today

UCafe has no general internal domain-event bus, message broker, or CRM event publisher.

- notification_deliveries is a durable, encrypted SMS delivery outbox. REQUEST_COUNSELING is an existing notification kind. It represents a delivery request, not an event contract for other modules.
- platform_audit_events stores selected operator-attributed audit actions. It is not complete lifecycle history or an integration event stream.
- Tenant, Subscription, and Payment state is stored in their owning tables/services. Their current writes do not publish the event names below as a public contract.
- The worker workspace is a bootstrap scaffold and does not currently coordinate these jobs.

## Phase 2–4 records, not published events

Phase 2 adds no event bus, publisher, outbox, or inter-module event contract. The actual Lead workflow persists history and operator audit records:

| Record | When it is written |
|---|---|
| `crm_lead_status_history` | Every manual Lead creation, public intake Lead creation, status change, qualification, unqualification, and conversion. It records previous/next status, optional reason, actor (nullable for public intake), and time. |
| `platform_audit_events` | Authenticated Lead create/update, status change, qualification, unqualification, conversion, assignment, archive, and restore. Audit summaries exclude phone/email and other contact PII. |
| `crm_deal_stage_history` | Deal creation and every stage change, with prior/next stage, pipeline key, actor, reason where required, and timestamp. |
| `platform_audit_events` | Authenticated Deal create/update, stage change, win/loss, archive, and restore. Summaries contain stage/outcome/reason keys only; no contact PII. |
| `platform_audit_events` | Activity create/update/archive/restore; Task create/update/complete/cancel/reopen/archive/restore; Note create/update/archive/restore. Each work mutation and audit row share one transaction. Summaries omit Activity subject/details, Task title/description, and Note body. |

Each Lead/Deal state change and its history/audit write commit in the same transaction. A consultation submission and its linked Lead are committed together with the existing notification enqueue. Phase 4 audit action strings use `crm.activity.*`, `crm.task.*`, and `crm.note.*`; these are records for audit review, not messages that other modules consume. The work objects are not published to notification deliveries or another outbox.

Phase 4 action names stored in `platform_audit_events.action` are:

- Activity: `crm.activity.created`, `crm.activity.updated`, `crm.activity.archived`, `crm.activity.restored`.
- Task: `crm.task.created`, `crm.task.updated`, `crm.task.completed`, `crm.task.canceled`, `crm.task.reopened`, `crm.task.archived`, `crm.task.restored`.
- Note: `crm.note.created`, `crm.note.updated`, `crm.note.archived`, `crm.note.restored`.

These audit actions are the Phase 4 event-support boundary. They are transactional and PII/content-safe, but no CRM integration event is published or made available for subscription.

## Planned external facts of interest

No current publisher contract exists. CRM may eventually read the corresponding source records:

- tenant.provisioned and tenant.status_changed
- trial.started and trial.expired
- subscription.activated, subscription.renewed, subscription.expired, and subscription.canceled
- payment.verified

Until a stable event contract exists, the source module remains authoritative and CRM reads its current projection. Do not infer a missing historical transition from a current status field.

## Payload and delivery rules for a future contract

Publish only after the source transaction commits. Include stable IDs, event type/version, occurred-at time, and actor/source metadata as needed. Do not put contact phone/email, notes, OTPs, payment secrets, or full customer details in an event payload; consumers should load an authorized projection. Event replay must not repeat a Tenant, Subscription, or Payment mutation.

CRM may also expose its own APIs for a future external consumer, including a Sales Engine only if UCafe later builds or connects one. No Sales Engine is assumed or included in this roadmap.
