# UCafe Platform CRM

**Status:** Phase 0 architecture foundation and Phase 1 Organizations & Contacts are implemented. Lead, Deal, Activity, Task, Note, timeline, and CRM analytics workflows remain unimplemented.

## Purpose and boundary

Platform CRM is an internal UCafe capability for platform operators and future platform sales staff to manage UCafe's relationship with prospective and existing café businesses. It will cover organizations, contacts, leads, sales opportunities, follow-up work, and their history.

It is not a CRM for a café's own customers. Tenant CRM remains a separate possible product. CRM records have platform scope and are not tenant-owned.

CRM owns commercial Organization and Contact details and, in future phases, sales workflow. It does not own café tenant lifecycle, subscriptions or trial rules, plan pricing, payment or invoice state, administrative identity, tenant clients, or public consultation submission delivery. A CRM Organization can exist before a Tenant and may later link to one. A Contact is not a platform User or tenant Client. A Deal is not a Subscription, Invoice, or Payment.

There is no Sales Engine in UCafe. This roadmap does not assume one or build one; another system could become a future consumer of documented CRM contracts.

## Existing-system fit

UCafe is a NestJS modular monolith on PostgreSQL with a Next.js App Router web app. Platform authority uses database-backed platform permissions. The existing public consultation form is stored in platform_order_requests and is exposed in a read-only platform inbox. That record is an intake submission; it is not yet a complete CRM lead workflow.

CRM is a platform-only module in the existing API and web application. Phase 1 adds Organizations and Contacts without changing the public consultation request or read-only inbox. A future Lead may link to an intake submission as its source record; do not copy the public intake stream into a second unrelated inbox.

## Main concepts

- **Organization:** the café business UCafe is pursuing or serving. It may exist before tenant provisioning.
- **Contact:** a person UCafe communicates with for an Organization.
- **Lead:** a sales follow-up record for one potential purchase or engagement. Its status is separate from Deal stage and Tenant state.
- **Deal:** a sales opportunity linked to an Organization, with its own pipeline stage and outcome.
- **Activity:** a historical interaction that happened.
- **Task:** work that still needs to happen.
- **Note:** internal context, separate from an interaction and scheduled work.
- **History:** append-only lead-status and deal-stage transitions; it supports audit and timeline views without event sourcing.

Phase 1 currently implements only Organization and Contact. Organization fields are name, optional city, website, canonical Instagram handle, optional unique Tenant link, creator/updater, timestamps, and archive timestamp. Contact belongs to one Organization and stores name, optional role, and optional phone/email encrypted at rest with keyed exact-match hashes. Contacts do not carry a decision-maker boolean; use the person's business title/role. See [DATA_MODEL.md](DATA_MODEL.md), [API.md](API.md), and [UX.md](UX.md) for the implemented contract.

For the initial product, one CRM Organization may link to at most one Tenant, and a Tenant to at most one CRM Organization. One Tenant already supports multiple branches. Revisit this simple link only if UCafe has a real business-group case with several independently provisioned Tenants.

## Source-of-truth rules

CRM owns Organization and Contact details used for sales, Lead status/source/assignment, Deal stage/outcome/estimated value, and manually recorded sales Activities, Tasks, and Notes.

Tenant, Subscription, Trial, Plan, and Payment facts remain with their existing modules. CRM may display them through read-only projections and link to their existing administration flows; it must not calculate or mutate their lifecycle. See [INTEGRATIONS.md](INTEGRATIONS.md).

## Recommended reading order

1. [DISCOVERY.md](DISCOVERY.md) — current code and conflicts
2. [DOMAIN_MODEL.md](DOMAIN_MODEL.md) and [DATA_MODEL.md](DATA_MODEL.md) — proposed ownership and relationships
3. [LIFECYCLE.md](LIFECYCLE.md) and [PIPELINE.md](PIPELINE.md) — statuses, conversion, stage history
4. [INTEGRATIONS.md](INTEGRATIONS.md), [EVENTS.md](EVENTS.md), and [PERMISSIONS.md](PERMISSIONS.md) — boundaries and access
5. [API.md](API.md), [UX.md](UX.md), [TIMELINE.md](TIMELINE.md), and [ANALYTICS.md](ANALYTICS.md) — future product contracts
6. [TESTING.md](TESTING.md) and [PHASES.md](PHASES.md) — implementation and verification sequence
7. [DECISIONS.md](../DECISIONS.md) — accepted CRM architecture decisions D-073 through D-075

Before implementing any CRM change, read this README and the relevant documents above, then inspect current code and migrations. Changes to CRM lifecycle, data ownership, APIs, integrations, or permissions must update the relevant CRM document and root decisions when the architecture changes.
