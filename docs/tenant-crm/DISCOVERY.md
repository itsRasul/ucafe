# Tenant CRM discovery

## Repository facts

UCafe is a NestJS modular monolith and Next.js App Router application backed by PostgreSQL. One shared database serves all cafés. Tenant context is derived from the request hostname or an authenticated internal proxy override. The current feature entitlement resolver combines effective subscription status with a boolean plan feature.

Administrative User identities and customer Client identities are separate. Client belongs to exactly one café, has a UUID, first and last name, E.164 phone, ACTIVE/BLOCKED status, phone verification and last-authentication timestamps, and created/updated timestamps. Client has no email, soft-delete column, CRM profile, notes, preferences, or marketing consent. The database enforces unique (coffee_shop_id, phone).

Client OTP is tenant and purpose scoped and reuses authentication crypto/provider infrastructure. OTP registration creates a Client; verified phone changes are OTP controlled. Staff reservation creation can create an unverified Client after normalizing the entered Iranian mobile number and requiring a name. A phone match only resolves a Client inside that café.

Every current Order requires a Client. Public checkout requires an authenticated tenant-scoped Client. There is no guest order path. Orders contain tenant, Client, delivery/payment, immutable price and promotion snapshots, status, status_changed_at, and line snapshots. Customer payment is offline only. Delivered-order value is tracked commerce value, not verified settlement.

Every current Reservation requires a Client. Public booking requires a client token; staff can book against an existing or newly created tenant Client. Statuses include pending, confirmed, rejected, canceled, completed, and no-show. There is no reservation-to-order link.

No standalone tenant-admin Client directory exists. Customer lookup is exposed through customer segments and Promotions workflows. These manual segments belong to Clients/Promotions and must keep current access and behavior when Tenant CRM is introduced.

The existing customer search applies parameterized ILIKE substring matching to first name, last name, concatenated full name, and stored phone, then orders/paginates by Client creation time. Phone search does not normalize the search input. The clients table has a tenant/created index and a per-tenant phone uniqueness constraint, but no dedicated name search index. Phase 1 should reuse the phone normalizer for complete phone queries and query the unique tenant/phone key; keep name search in PostgreSQL and tenant-filtered, and measure before adding trigram/full-text indexes or a search service.

## Compatibility findings

| Area | Current behavior | Tenant CRM decision |
| --- | --- | --- |
| Client identity | Café-scoped record, unique café plus normalized phone | Reuse Client; do not create a parallel identity |
| Client creation | OTP registration or staff reservation flow | Preserve both flows; directory is not a replacement auth path |
| Client profile | Customer self-service edits names and phone through protected client APIs | CRM may later edit only through an authorized tenant workflow; define conflict behavior before implementation |
| Orders | Required Client FK; tenant ownership checked in service and database trigger | Orders remains authoritative; CRM reads it |
| Reservations | Required Client FK; staff/customer workflows use tenant scope | Reservations remains authoritative; CRM reads it |
| Client page | No /admin/clients route; customer search is in Promotions segments | Add CRM directory at /admin/crm; do not duplicate current segment/customer management |
| Client search | SQL ILIKE substring search in customer segments; no dedicated search index | Reuse PostgreSQL for Phase 1; measure before introducing indexes or search infrastructure |
| Manual segments | customer_segments and memberships are tenant scoped and promotion eligibility consumes them | Keep these existing rule groups; dynamic CRM segments are a later distinct capability and need an explicit compatibility design |
| Platform CRM | Separate platform-owned Organizations, Contacts, Leads, etc. | No shared CRM domain entities or cross-CRM links |

## Isolation enforcement today

TenantContextMiddleware resolves a tenant from the trusted host. TenantPermissionGuard resolves the authenticated administrative User's membership and permissions for that tenant. Services receive the resolved coffeeShopId and scope queries explicitly. Existing Client phone uniqueness is per café. Client addresses, client sessions, Orders, and customer-segment membership use database tenant checks or composite tenant constraints. Reservations have tenant-scoped service queries; their Client FK alone is not a composite café/Client constraint, so future CRM relationships must not treat a simple FK as sufficient tenant integrity.

## Adjacent systems

- Discounts and manual customer segments depend on Client and Order sources, not Platform CRM.
- Tenant Analytics already reports customer rankings and repeat behavior from delivered Orders and Client IDs.
- sms.ir handles OTP and the durable notification outbox handles transactional messages. No marketing-consent model or CRM campaign system exists.
- Platform CRM Phase 9 has its own transactional CRM workflow outbox. It is domain-specific and is not a general event bus.
- Plans are managed through a typed feature registry and Platform Admin plan editor. Current keys do not include tenant_crm.
- Platform audit is not a tenant CRM audit facility. Do not write tenant customer actions into platform audit records.

## Open decisions

- Define legal/product retention, client deletion/anonymization, export, and consent policy before storing new sensitive customer fields or sending marketing messages.
- Define whether CRM notes can contain sensitive data and what staff roles can read them before Notes phase.
- Define the operator confirmation and relationship-rewrite semantics before any Client merge feature.

Questions already answered by code: Orders and Reservations cannot currently be created without a Client; clients are café-scoped rather than globally authenticated; phone is normalized to E.164 and uniquely constrained per café.

## Phase 1 implementation update

The Tenant Admin now has `/admin/crm` and Client detail routes backed by `GET /tenant/crm/clients` and `GET /tenant/crm/clients/:clientId`. The SQL list is tenant scoped, supports name or normalized exact-phone search, status filtering, allowlisted sorting, and pagination. Directory phones are masked; detail phone is full. Both routes check `tenant_crm.read` and effective `tenant_crm`.

Migration `1790590000000-TenantCrmDirectory` grants the read permission to the owner role and adds plan defaults only where no tenant_crm value was already configured. It creates no Client or CRM tables. No Client create/edit/archive/merge or lifecycle events were added. Client self-service can return the authenticated Client's own phone; the former broad statement that client projections omit phone was inaccurate.
