# UCafe Platform CRM

**Status:** Phases 0–8 are implemented: Organizations & Contacts, Leads, Deals and Pipeline, Activities, Tasks, Notes, Unified Timeline, Organization 360, read-only Tenant/Trial/Subscription context, custom fields, Tags, saved views, dynamic Segments, and explainable Lead scoring. Workflow automation and CRM analytics remain later work.

## Purpose and boundary

Platform CRM is an internal UCafe capability for platform operators and future platform sales staff to manage UCafe's relationship with prospective and existing café businesses. It covers organizations, contacts, leads, sales opportunities, historical interactions, follow-up work, internal notes, and stage/status history.

It is not a CRM for a café's own customers. Tenant CRM remains a separate possible product. CRM records have platform scope and are not tenant-owned. Phase 4 records manual historical interactions, future work, and human context; it does not synchronize communication channels or automate workflows.

CRM owns commercial Organization and Contact details, Lead sales workflow, and Deal pipeline judgments. A Deal may reference the code-defined pipeline, a qualified or converted Lead, an expected Plan, and an estimate, but does not own café tenant lifecycle, subscriptions or trial rules, plan pricing, payment or invoice state, administrative identity, tenant clients, or public consultation submission delivery. A CRM Organization can exist before a Tenant and may later link to one. A Contact is not a platform User or tenant Client. A Deal is not a Subscription, Invoice, or Payment.

There is no Sales Engine in UCafe. This roadmap does not assume one or build one; another system could become a future consumer of documented CRM contracts.

## Existing-system fit

UCafe is a NestJS modular monolith on PostgreSQL with a Next.js App Router web app. Platform authority uses database-backed platform permissions. The existing public consultation form is stored in platform_order_requests and is exposed in a read-only platform inbox. That record is an intake submission; it is not yet a complete CRM lead workflow.

CRM is a platform-only module in the existing API and web application. Phase 2 adds Leads and creates one Lead in the same transaction as each accepted public consultation request, retaining the original request as intake evidence. Existing requests are not backfilled. The public response, SMS notification, and request inbox contract remain unchanged.

## Main concepts

- **Organization:** the café business UCafe is pursuing or serving. It may exist before tenant provisioning.
- **Contact:** a person UCafe communicates with for an Organization.
- **Lead:** a sales follow-up record for one potential purchase or engagement. Its status is separate from Deal stage and Tenant state.
- **Lead score:** persisted, deterministic Fit and Engagement scores plus an Overall score and rule contribution snapshot. It assists human prioritization; it is independent from manual priority and lifecycle state.
- **Deal:** a sales opportunity linked to an Organization, with its own pipeline stage and outcome.
- **Activity:** a historical interaction that happened, with `occurredAt`, type-specific outcome, and actor.
- **Task:** future/outstanding work with due time, assignee, priority, and explicit lifecycle. Follow-up is a Task kind; overdue is derived from its open status and due time.
- **Note:** plain-text internal context with author and edit/archive metadata.
- **History:** append-only Lead-status and Deal-stage transitions. Activity, Task, and Note records remain separate; the Phase 5–6 Timeline is a paginated read-time aggregation of CRM histories and selected durable customer facts, not an event bus or persisted duplicate.
- **Custom field:** a typed, administrator-defined value attached to an Organization, Contact, Lead, or Deal. Definitions and select options are relational; per-record values live in validated JSONB. Archived definitions/options retain historical values and option IDs.
- **Tag:** a normalized, shared label that may be assigned to any supported CRM record. Archived tags retain assignments and disappear from new choices.
- **Saved view:** an owned PRIVATE or CRM-wide SHARED filter set. It stores filter criteria, ordinary list filters, and an allowlisted sort; it never stores record IDs.
- **Segment:** a named, dynamic filter over one supported CRM record type. Membership is recalculated from the current database on preview and page reads; it is not a campaign audience or persisted membership list.

Scoring rules reuse the Phase 7 flat AND/OR Lead filter criteria and custom-field/Tag validation. Score itself is available to Saved Views and Segments, but score fields are prohibited in scoring rules to prevent recursion. See [SCORING.md](SCORING.md).

Phase 1 implements Organization and Contact. Phase 2 adds Lead snapshots, exact duplicate warnings, assignment, qualification, unqualification, status history, archive/restore, and conversion to an Organization plus Contact. Conversion itself creates no Deal; Phase 3 allows an operator to explicitly create a Deal from a qualified or converted Lead already linked to an Organization. Lead phone/email are encrypted at rest with keyed exact-match hashes. Contacts do not carry a decision-maker boolean; use the person's business title/role. See [DATA_MODEL.md](DATA_MODEL.md), [LIFECYCLE.md](LIFECYCLE.md), [API.md](API.md), and [UX.md](UX.md) for the implemented contract.

For the initial product, one CRM Organization may link to at most one Tenant, and a Tenant to at most one CRM Organization. One Tenant already supports multiple branches. Revisit this simple link only if UCafe has a real business-group case with several independently provisioned Tenants.

## Source-of-truth rules

CRM owns Organization and Contact details used for sales, Lead source/status/assignment/qualification and conversion, Deal stage/outcome/estimated value, and manually recorded Activities, Tasks, and Notes. Organization 360 is a composed read view. Unified Timeline queries durable CRM histories and work records at read time; it has no persistence table or separate source of truth.

Tenant, Subscription, Trial, Plan, and Payment facts remain with their existing modules. CRM reads current context through owner-module projections and includes only durable Tenant creation, CRM link changes, Trial start, and successful paid Subscription operations in its query-time Timeline. It does not copy or mutate their lifecycle. Tenant link/unlink is explicit and transactionally audited. UCafe has no CRM event publisher or general event bus. See [INTEGRATIONS.md](INTEGRATIONS.md) and [EVENTS.md](EVENTS.md).

## Recommended reading order

1. [DISCOVERY.md](DISCOVERY.md) — current code and conflicts
2. [DOMAIN_MODEL.md](DOMAIN_MODEL.md) and [DATA_MODEL.md](DATA_MODEL.md) — ownership and relationships
3. [LIFECYCLE.md](LIFECYCLE.md), [PIPELINE.md](PIPELINE.md), [ACTIVITIES.md](ACTIVITIES.md), and [TASKS.md](TASKS.md) — implemented lifecycles
4. [INTEGRATIONS.md](INTEGRATIONS.md), [EVENTS.md](EVENTS.md), and [PERMISSIONS.md](PERMISSIONS.md) — boundaries and access
5. [API.md](API.md), [CUSTOM_FIELDS.md](CUSTOM_FIELDS.md), [FILTERING.md](FILTERING.md), [SEGMENTATION.md](SEGMENTATION.md), [SCORING.md](SCORING.md), and [UX.md](UX.md) — metadata, filters, scores, and screens
6. [TIMELINE.md](TIMELINE.md), [ANALYTICS.md](ANALYTICS.md), [TESTING.md](TESTING.md), and [PHASES.md](PHASES.md) — read views, verification, and roadmap
7. [ADR-007](ADR-007-custom-field-storage.md), [ADR-008](ADR-008-lead-scoring-persistence.md), and [DECISIONS.md](../DECISIONS.md) — CRM architecture decisions D-073 through D-082

Before implementing any CRM change, read this README and the relevant documents above, then inspect current code and migrations. Changes to CRM lifecycle, data ownership, APIs, integrations, or permissions must update the relevant CRM document and root decisions when the architecture changes.
