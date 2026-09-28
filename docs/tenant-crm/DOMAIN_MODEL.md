# Tenant CRM domain model

## Bounded context

Tenant CRM models one café's ongoing relationship with its own Clients. It is a tenant-owned capability in the existing API and Tenant Admin app. Platform CRM remains a platform-owned sales domain about cafés and has no customer-level relationship with Tenant CRM.

## Actors and subjects

- User is the authenticated tenant owner/staff actor. Membership, role, permission, and tenant context authorize actions.
- Client is the customer subject and stable local identity.
- Same-person contact details at another café do not connect records or expose activity across cafés.

## Conceptual model

Client is the central identity. Future CRM-owned records may reference (coffee_shop_id, client_id), and actor fields reference User where needed. Orders and Reservations are linked source records, not CRM-owned children. Preferences, notes, tags, custom fields, reminders, loyalty, feedback, campaigns, and automation are future concepts only; add each only in its roadmap phase and after defining ownership, privacy, and tenant integrity.

Do not create Customer, Guest, CustomerProfile, TenantCustomerProfile, GlobalCustomer, or equivalent aliases. A supplemental profile is not justified for Phase 1. If a later field cannot appropriately live on Client, store it in a narrowly scoped tenant CRM table.

## Source ownership

Client owns identity and authentication state. Orders own commerce events and snapshots. Reservations own booking facts and status. Discounts own definitions, eligibility, and redemption. Analytics owns existing commerce reports. Tenant CRM owns only data introduced for relationship management and its future read experiences.

Derived values such as order count, completed-order count, Known UCafe Spend, average order, and last order must be read from Orders or an explicit measured read model. Do not duplicate counters on Client in Phase 0.

## Lifecycle and identity policy

Phase 1 is a read-only paginated directory over current Clients, with normalized exact phone search within the current café. Names are not an automatic merge key. Similar names or cross-café phone matches never merge or link customer records. Client creation remains in existing OTP and reservation flows. Merge is out of scope until a later explicit design covers every relationship and preserves source history.

There is no Client archive/delete route or deleted_at field today; soft deletion applies to Client addresses and customer segments. Hard delete is constrained by Orders and Reservations, which RESTRICT deleting a referenced Client. CRM must not invent archive, anonymization, or retention semantics; a future privacy workflow must coordinate with those source owners.

## Platform CRM separation

Do not reuse Platform CRM Organization, Contact, Lead, Deal, Activity, Task, Note, Tag, Segment, scoring, filter, automation, or analytics business objects. Generic pagination, phone normalization, plan feature entitlement, DTO validation, and domain-neutral UI primitives may be reused after confirming their contracts fit.
