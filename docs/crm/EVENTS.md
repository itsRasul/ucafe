# Event catalog

## What exists today

UCafe has no general internal domain-event bus, message broker, or CRM event publisher.

- notification_deliveries is a durable, encrypted SMS delivery outbox. REQUEST_COUNSELING is an existing notification kind. It represents a delivery request, not an event contract for other modules.
- platform_audit_events stores selected operator-attributed audit actions. It is not complete lifecycle history or an integration event stream.
- Tenant, Subscription, and Payment state is stored in their owning tables/services. Their current writes do not publish the event names below as a public contract.
- The worker workspace is a bootstrap scaffold and does not currently coordinate these jobs.

## Planned CRM-owned facts

The following names are proposals for a future internal contract. They do not exist in code.

| Planned event | When it should be emitted |
|---|---|
| crm.organization.created / crm.organization.updated / crm.organization.archived | A CRM Organization changes through an authorized CRM operation. |
| crm.contact.created / crm.contact.updated / crm.contact.archived | A CRM Contact changes through an authorized CRM operation. |
| crm.lead.created | A Lead is created, including its source identifier where applicable. |
| crm.lead.status_changed | Lead status changes and its history row commits. |
| crm.lead.qualified | A Lead enters QUALIFIED. |
| crm.lead.converted | The conversion and its Organization/Contact/Deal references commit. |
| crm.deal.created | A Deal is created. |
| crm.deal.stage_changed | Deal stage and stage history commit. |
| crm.deal.won / crm.deal.lost | A Deal outcome is explicitly closed. |
| crm.activity.created | A historical interaction is recorded. |
| crm.task.created / crm.task.completed | A Task is created or marked complete. |

CRM entity writes and their required history must commit atomically. If a future consumer requires durable delivery beyond in-process callers, introduce the smallest transactional outbox required for domain events; do not repurpose notification_deliveries.

## Planned external facts of interest

These event names are also conceptual only; no current publisher contract exists. CRM may eventually consume or read the corresponding source records:

- tenant.provisioned and tenant.status_changed
- trial.started and trial.expired
- subscription.activated, subscription.renewed, subscription.expired, and subscription.canceled
- payment.verified

Until a stable event contract exists, the source module remains authoritative and CRM reads its current projection. Do not infer a missing historical transition from a current status field.

## Payload and delivery rules for a future contract

Publish only after the source transaction commits. Include stable IDs, event type/version, occurred-at time, and actor/source metadata as needed. Do not put contact phone/email, notes, OTPs, payment secrets, or full customer details in an event payload; consumers should load an authorized projection. Event replay must not repeat a Tenant, Subscription, or Payment mutation.

CRM may also expose its own APIs for a future external consumer, including a Sales Engine only if UCafe later builds or connects one. No Sales Engine is assumed or included in this roadmap.

