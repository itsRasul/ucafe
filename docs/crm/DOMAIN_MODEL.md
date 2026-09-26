# Domain model

## Scope

Platform CRM is a platform-domain workspace for managing UCafe's commercial relationship with prospective and existing café businesses. Its users are platform operators or future platform sales staff. It is not tenant-owned and is not a tool for a cafe to manage its own guests or marketing.

CRM owns sales context and workflow. It does not own Tenant identity/lifecycle, subscriptions/trials/plans, payments/invoices, platform or tenant authentication, cafe Clients, promotion segments, or Tenant Analytics.

Phases 1–8 implement Organization, Contact, Lead, Deal, Activity, Task, Note, their relevant histories, Unified Timeline, Organization 360, read-only Tenant/Trial/Subscription context, typed metadata, and persisted Lead scores. The views are application projections, not domain entities. Current fields and persistence choices are listed in [DATA_MODEL.md](DATA_MODEL.md).

## Concepts

| Concept | Responsibility and ownership | Relationships | Explicitly not |
|---|---|---|---|
| Organization | Canonical business record for a café or café business UCafe may pursue or serves. CRM owns its commercial display name, city, public web/social references, and archive state. | Has Contacts, Leads, Deals, and CRM work history. May optionally link to one Tenant. | Not a provisioned Tenant, subscription status, or an Organization lifecycle enum that repeats Tenant state. |
| Contact | A person UCafe communicates with about an Organization. CRM owns name, business role, preferred communication details, and archive state. | Belongs to one Organization initially; may be referenced by Leads, Deals, Activities, Tasks, and Notes. | Not a User, membership, or cafe Client. A matching phone/email is only a duplicate signal, not identity proof. |
| Lead | A sales-follow-up record with a temporary prospect snapshot, source, status, priority, owner/assignee, qualification facts, and conversion timestamp. CRM owns this lifecycle. | May start without canonical links; can link to one Organization and optional primary Contact before conversion. A converted Lead links to an Organization and Contact and may retain its unique originating intake request. | Not the consultation submission itself, Tenant signup, or Deal stage. |
| Deal | A concrete commercial opportunity with an Organization, optional expected Plan and integer-Toman forecast, current stage, explicit outcome, and close/loss details. CRM owns those sales judgments. | Belongs to an Organization; may refer to one primary Contact, one qualified or converted originating Lead already linked to that Organization, and an active platform owner; has append-only stage history in the code-defined default pipeline. | Not a Subscription, purchased plan, invoice, Payment, collected revenue, or Tenant state. |
| Activity | A historical interaction that happened, with its own `occurredAt`, type-specific outcome, and Platform User actor. | Explicit optional Organization, Contact, Lead, and Deal FKs; at least one context is required. A Lead-only association is valid before conversion. | Not future work, provider delivery proof, an audit event, or an automatically inferred communication. |
| Task | Future/outstanding work with due time, assignee, priority, status, and completion/cancellation actor/time. | Explicit optional Organization, Contact, Lead, and Deal FKs; at least one context is required. A Lead-only association is valid before conversion. Follow-up is a Task kind. | Not an Activity when completed; completion does not prove a call or email happened. |
| Note | Plain-text internal business context authored by platform staff, with explicit edit/archive metadata. | Explicit optional Organization, Contact, Lead, and Deal FKs; at least one context is required. A Lead-only association is valid before conversion. | Not an Activity, customer-facing message, or a payment/subscription memo. |
| Lead status history | Append-only record of each Lead status transition, actor, timestamp, and optional reason. | Belongs to one Lead. | Not a general event bus or replacement for the current Lead status. |
| Lead score | Persisted bounded Fit, Engagement, and Overall values with a calculated time, rule-set version, and explainable point snapshot. | One current score row and append-only rows when its scoring state changes. | Not manual Priority, status, qualification, Deal stage, health, or conversion probability. It makes no lifecycle or outreach decision. |
| Deal stage history | Append-only record of each stage transition, actor, timestamp, and optional reason. | Belongs to one Deal. | Not Subscription history or a financial ledger. |
| Unified Timeline | Normalized chronological application view of selected CRM history/work records and durable customer facts. | Derived from CRM histories, explicit Tenant-link audit records, Tenant creation, Trial start, and successful paid Subscription operations. | Not a persisted entity, event bus, generic audit feed, or replacement for source records. |
| Organization 360 | Bounded composed view of Organization, associated CRM records, derived summary facts, a paginated Timeline, and authorized live customer context. | Read-only application layer over Tenant and Subscription projections; link/unlink uses an explicit CRM operation. | Not a second Organization model or owner of Tenant/Subscription state. |

An Organization is a long-lived business identity. A Lead is one sales engagement; the same Organization may have separate Leads over time. A Deal is a specific opportunity. After a closed opportunity, a future renewal or reactivation pursuit should create a new Deal rather than reopen a closed historical one.

## Conversion

Phase 2 conversion preserves the Lead and, in one transaction, resolves or creates the canonical Organization and Contact after duplicate checks, links both records, marks the Lead CONVERTED, and appends status history. It creates no Deal. Phase 3 lets an operator explicitly create at most one Deal from a qualified or converted Lead already linked to the same Organization; this preserves the Lead and its lifecycle.

The Lead is never deleted as a side effect of conversion. Detailed state transitions are in [LIFECYCLE.md](LIFECYCLE.md).

## Important distinctions

- Organization is not Tenant; it can precede one, and it does not mirror Tenant status.
- Contact is not User or Client; CRM relationships never grant authentication or tenant authority.
- Lead is not Organization; one business can have many sales engagements.
- Lead is not a consultation request; a form request is source/intake evidence linked to one Lead.
- Deal is not Subscription, Trial, Invoice, or Payment; CRM amount is an estimate and CRM outcome is a sales decision.
- An explicit Organization/Tenant link is an association only. It does not provision or change Tenant state, create a Trial, or establish a sales outcome.
- Lead status is not Deal stage; Deal stage is not Deal outcome.
- Score is not manual Priority, qualification, a conversion probability, or Customer Health. It only informs an operator's prioritization.
- Activity is something that happened. Task is something that needs to happen.
- Follow-up is a CRM Task with kind `FOLLOW_UP`; it is not a separate domain or reminder job.
- Work relationships use explicit foreign keys and must agree on Organization. Lead-only records remain attached to a pre-conversion Lead and are visible from its Organization after conversion through a read projection.
- Activity, Task, Note, LeadStatusHistory, and DealStageHistory remain separate sources. Timeline normalizes them at read time and does not copy them into another projection table. Only selected Task lifecycle actions and Deal closure attribution are read from `platform_audit_events`, as documented in [TIMELINE.md](TIMELINE.md).

In Phase 1 a Contact's role/title is free text and can describe an owner or decision maker. There is no separate decision-maker flag or primary-contact pointer because neither was approved in the Phase 0 model.

## Deferred concepts

Pipelines and stages are a single code-defined UCafe default in the initial version. Custom pipeline configuration, contact-to-multiple-organization relationships, record-level sharing, workflow automation, and analytics remain deferred until real operating needs justify them. Lead scoring currently evaluates Lead fields, Lead custom fields/Tags, and bounded Activity aggregates; Contacts, Tasks, Deals, Organization attributes, and Tenant/Subscription context are not score sources.
