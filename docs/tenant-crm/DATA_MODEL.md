# Tenant CRM data model

## Existing customer data

The current clients table is the customer identity store: UUID id, coffee_shop_id, first_name, last_name, E.164 phone, status, phone_verified_at, last_authenticated_at, created_at, updated_at. It has unique (coffee_shop_id, phone) and a tenant/created index. It has no email, deleted_at, CRM fields, or CRM-created-by actor.

Current customer-segment search uses SQL ILIKE substring matching across names and phone without normalizing the search input. The Phase 1 CRM directory uses parameterized SQL scoped to coffee_shop_id, normalizes complete Iranian phone searches through the existing utility, allowlists name/creation sorting, and applies status filtering and pagination in PostgreSQL. No search-specific name index was added.

client_addresses are soft deleted. Client sessions are tenant and Client scoped. Orders and Reservations have required client_id. Customer segments and memberships are existing manual promotion/customer group tables; memberships include tenant scope and composite same-tenant references.

## Phase 1 persistence decision

Phase 1 reads existing Client rows and adds no CRM tables, columns, indexes, or entities. Migration `1790590000000-TenantCrmDirectory` adds the owner read permission and initializes missing `tenant_crm` plan values; it preserves explicitly configured feature values.

## Phase 2 read composition

Customer 360 is query-derived from the tenant-scoped Client, Orders, and Reservations tables. A summary aggregate and bounded recent-record queries return only CRM-facing projections; Timeline uses one `UNION ALL` read over Client creation plus Order/Reservation creation and each source row's currently retained latest status transition. No Customer 360 table, event table, copied source data, migration, or index was added. `EXPLAIN (ANALYZE, BUFFERS)` on the actual summary, previews, and first/cursor Timeline queries at the local fixture size selected sequential scans and bounded top-N sorting. This small fixture does not represent production volume. No composite index was justified by those plans; recheck with representative tenant history before adding one.

## Future persistence rules

- Use an explicit tenant CRM table prefix such as tenant_crm_ to distinguish storage from platform crm_ tables and existing Clients/Promotions tables.
- Future client-related CRM rows carry coffee_shop_id and client_id. Use composite tenant/client keys or equivalent database enforcement so a café-owned row cannot point to another café's Client.
- Actor references identify tenant Users, never the customer Client. Keep audit summaries free of phone, notes, preferences, and other customer PII.
- Do not write tenant customer actions to platform_audit_events. Add tenant-owned audit history only with an implemented CRM write workflow and a defined actor/retention contract.
- Keep source-domain records authoritative. Do not copy Orders or Reservations into CRM tables to build a timeline.
- Add only indexes supported by actual query patterns. Existing indexes are not presumed sufficient or insufficient; inspect query plans at representative volume before adding search or aggregate indexes.
- Use forward TypeORM migrations; synchronization stays disabled.

## Table naming and ownership

Existing clients, orders, reservations, customer_segments and customer_segment_memberships retain their current names and owners. Future Tenant CRM-specific storage uses tenant_crm_* names and a tenant-crm module namespace. Platform CRM keeps its existing crm_* tables. No renaming of current storage is proposed.
