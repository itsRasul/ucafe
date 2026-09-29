# Tenant CRM domain model

## Bounded context

Tenant CRM models one café's ongoing relationship with its own Clients. It is a tenant-owned capability in the existing API and Tenant Admin app. Platform CRM remains a platform-owned sales domain about cafés and has no customer-level relationship with Tenant CRM.

## Actors and subjects

- User is the authenticated tenant owner/staff actor. Membership, role, permission, and tenant context authorize actions.
- Client is the customer subject and stable local identity.
- Same-person contact details at another café do not connect records or expose activity across cafés.

## Conceptual model

Client is the central identity. Customer 360 composes a read view from Client, Orders, and Reservations; conceptually Orders and Reservations refer to Client, while Tenant CRM reads those relationships in the other direction. They are linked source records, not CRM-owned children. Customer 360 is not an entity or source of truth. Phase 3 adds café-entered preferences, internal notes, tags, custom fields, and reminders as CRM-owned records referencing `(coffee_shop_id, client_id)`; actor fields reference tenant User membership where required. Phase 5 adds Loyalty around the same Client. Phase 6 adds customer Feedback and a small recovery state; its source records remain Orders/Reservations, and staff follow-up uses the existing Reminder.

Do not create Customer, Guest, CustomerProfile, TenantCustomerProfile, GlobalCustomer, or equivalent aliases. A supplemental profile is not justified for Phase 1. If a later field cannot appropriately live on Client, store it in a narrowly scoped tenant CRM table.

## Source ownership

Client owns identity and authentication state. Orders own commerce events and snapshots. Reservations own booking facts and status. Discounts own definitions, eligibility, and redemption. Analytics owns existing commerce reports. Tenant CRM owns only data introduced for relationship management and its future read experiences.

Derived values such as tracked/delivered order counts, Known UCafe Spend, average delivered order value, reservation outcomes, and last interaction are read from source rows in the Phase 2 Customer 360 query. Do not duplicate counters on Client or copy source records into CRM.

## Lifecycle and identity policy

Phase 1 is a read-only paginated directory over current Clients, with normalized exact phone search within the current café. Names are not an automatic merge key. Similar names or cross-café phone matches never merge or link customer records. Client creation remains in existing OTP and reservation flows. Merge is out of scope until a later explicit design covers every relationship and preserves source history.

There is no Client archive/delete route or deleted_at field today; soft deletion applies to Client addresses and customer segments. Hard delete is constrained by Orders and Reservations, which RESTRICT deleting a referenced Client. CRM must not invent archive, anonymization, or retention semantics; a future privacy workflow must coordinate with those source owners.

## Platform CRM separation

**Phase 3 relationship data.**

`Client` remains the customer identity. Tenant CRM adds a profile row for manually entered preferences, internal Notes, tenant-owned Tags and Client assignments, tenant-owned Custom Field definitions and typed values, and Reminders. These are café-entered relationship facts; they do not replace or cache Order and Reservation facts. No Platform CRM domain or persistence is shared.

Do not reuse Platform CRM Organization, Contact, Lead, Deal, Activity, Task, Note, Tag, Segment, scoring, filter, automation, or analytics business objects. Generic pagination, phone normalization, plan feature entitlement, DTO validation, and domain-neutral UI primitives may be reused after confirming their contracts fit.

## Phase 4 Segments

A Tenant CRM Segment belongs to one café and stores its name, optional description, versioned typed criteria, active status, creator, and timestamps. Its criteria query the current tenant-owned Client population and current CRM, Order, and Reservation sources. A Segment does not own Client membership: matching rows are computed on demand, and Phase 4 stores no membership snapshot, enter/exit history, or synchronization state. Smart Groups are deterministic system criteria evaluated by the same compiler; they are not saved Segment records.

Tags are manually assigned labels and remain separate from Segments, which are dynamic predicates. Promotions manual customer groups remain in their existing domain. Tenant CRM Segments do not reuse or expose Platform CRM Segment records or filtering semantics. Later Campaign work may consume a current Segment predicate only after it defines its own consent, eligibility, and history contract.

## Phase 5 Loyalty

Loyalty is another tenant-owned relationship around `Client`; it adds no alternate customer identity. A café owns its versioned earning configuration, lazy per-Client account, signed ledger, reward catalog, and redemption history. Orders remain authoritative for qualifying activity and amount; the ledger records the points consequence. The current balance is the sum of ledger rows, not a mutable Client field. Loyalty rewards and redemptions do not own Menu Items, Discounts, checkout, or Platform CRM data.

## Phase 6 Feedback

```text
Client
  ↓
TenantCrmFeedback
  ├── Order? (same tenant and Client)
  ├── Reservation? (same tenant and Client)
  └── service-recovery state
```

Feedback belongs to one café and one existing Client. It stores the customer's rating/comment and limited staff recovery outcome, while Customer 360 and Timeline remain read projections. Feedback is not a support Ticket, thread, review request, or Platform CRM Activity/Task/Note. See [FEEDBACK.md](FEEDBACK.md) for exact source, lifecycle, permission, privacy, and API semantics.


## Phase 7 Offers

An Offer is a CRM targeting record linked one-to-one with an existing tenant Promotion and to one saved CRM Segment. Draft Offers do not change pricing. Activation records the current Segment audience; the existing Promotion remains the sole source of discount terms and redemption behavior. Ending an Offer disables its targeting link without changing or reopening the Promotion.
