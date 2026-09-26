# Domain model

## Scope

Platform CRM is a platform-domain workspace for managing UCafe's commercial relationship with prospective and existing café businesses. Its users are platform operators or future platform sales staff. It is not tenant-owned and is not a tool for a cafe to manage its own guests or marketing.

CRM owns sales context and workflow. It does not own Tenant identity/lifecycle, subscriptions/trials/plans, payments/invoices, platform or tenant authentication, cafe Clients, promotion segments, or Tenant Analytics.

Phase 1 implements Organization and Contact; Phase 2 implements Lead and Lead status history. Deal, Activity, Task, Note, and timeline contracts below remain future-phase scope. Current fields and persistence choices are listed in [DATA_MODEL.md](DATA_MODEL.md).

## Concepts

| Concept | Responsibility and ownership | Relationships | Explicitly not |
|---|---|---|---|
| Organization | Canonical business record for a café or café business UCafe may pursue or serves. CRM owns its commercial display name, city, public web/social references, and archive state. | Has Contacts, Leads, Deals, and CRM work history. May optionally link to one Tenant. | Not a provisioned Tenant, subscription status, or an Organization lifecycle enum that repeats Tenant state. |
| Contact | A person UCafe communicates with about an Organization. CRM owns name, business role, preferred communication details, and archive state. | Belongs to one Organization initially; may be referenced by Leads, Deals, Activities, Tasks, and Notes. | Not a User, membership, or cafe Client. A matching phone/email is only a duplicate signal, not identity proof. |
| Lead | A sales-follow-up record with a temporary prospect snapshot, source, status, priority, owner/assignee, qualification facts, and conversion timestamp. CRM owns this lifecycle. | May start without canonical links; can link to one Organization and optional primary Contact before conversion. A converted Lead links to an Organization and Contact and may retain its unique originating intake request. | Not the consultation submission itself, Tenant signup, or Deal stage. |
| Deal | A commercial opportunity with an Organization, expected value if known, current pipeline stage, outcome, and close/loss details. CRM owns those sales judgments. | Belongs to an Organization; may refer to the primary Contact and originating Lead; has append-only stage history. | Not a Subscription, plan selection, invoice, Payment, collected revenue, or Tenant state. |
| Activity | A historical interaction that happened, such as a call, meeting, email, SMS, WhatsApp contact, demo, or other follow-up. CRM owns the manual interaction record and actor/time. | Anchored to an Organization; may relate to a Contact, Lead, Deal, and/or completed Task. | Not future work, provider delivery proof, an audit event, or an automatically inferred communication. |
| Task | Work that still needs to happen, such as calling or preparing a demo. CRM owns its due date, assignee, status, and completion. | Anchored to an Organization; may relate to a Contact, Lead, or Deal. | Not an Activity until it is completed; completion does not prove a call or email happened. |
| Note | Internal business context authored by platform staff. | Belongs to an Organization and may reference a Lead or Deal. | Not an Activity, customer-facing message, or a payment/subscription memo. |
| Lead status history | Append-only record of each Lead status transition, actor, timestamp, and optional reason. | Belongs to one Lead. | Not a general event bus or replacement for the current Lead status. |
| Deal stage history | Append-only record of each stage transition, actor, timestamp, and optional reason. | Belongs to one Deal. | Not Subscription history or a financial ledger. |

An Organization is a long-lived business identity. A Lead is one sales engagement; the same Organization may have separate Leads over time. A Deal is a specific opportunity. After a closed opportunity, a future renewal or reactivation pursuit should create a new Deal rather than reopen a closed historical one.

## Conversion

Phase 2 conversion preserves the Lead and, in one transaction, resolves or creates the canonical Organization and Contact after duplicate checks, links both records, marks the Lead CONVERTED, and appends status history. A retry returns the existing conversion result. It creates no Deal; Phase 3 can associate a Deal with the converted Lead and its Organization/Contact.

The Lead is never deleted as a side effect of conversion. Detailed state transitions are in [LIFECYCLE.md](LIFECYCLE.md).

## Important distinctions

- Organization is not Tenant; it can precede one, and it does not mirror Tenant status.
- Contact is not User or Client; CRM relationships never grant authentication or tenant authority.
- Lead is not Organization; one business can have many sales engagements.
- Lead is not a consultation request; a form request is source/intake evidence linked to one Lead.
- Deal is not Subscription, Trial, Invoice, or Payment; CRM amount is an estimate and CRM outcome is a sales decision.
- Lead status is not Deal stage; Deal stage is not Deal outcome.
- Activity is something that happened. Task is something that needs to happen.

In Phase 1 a Contact's role/title is free text and can describe an owner or decision maker. There is no separate decision-maker flag or primary-contact pointer because neither was approved in the Phase 0 model.

## Deferred concepts

Pipelines and stages are a single code-defined UCafe default in the initial version. Custom pipeline configuration, tags, custom fields, contact-to-multiple-organization relationships, record-level sharing, and workflow automation are deferred until real operating needs justify them.
