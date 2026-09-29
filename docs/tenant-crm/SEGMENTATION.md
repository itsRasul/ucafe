# Tenant CRM Segmentation

**Phase 4 status:** Implemented in the API and Tenant Admin UI. The focused PostgreSQL isolation/dynamic-membership/EXPLAIN integration passed during the Phase 5 regression run; authenticated visual acceptance remains pending.

## Model

A Segment is a named, tenant-owned, versioned criteria document evaluated against current Clients and current source rows. It does not own Client membership. Preview and member pages run the same criteria compiler on PostgreSQL; membership changes as source data changes, with no member-ID snapshot, member table, cache, or synchronization job.

Tags remain manually assigned CRM labels. Segments are dynamic predicates and may include Tag criteria. The manual Promotions customer groups remain separate and unchanged. Tenant CRM Segments are unrelated to Platform CRM Segment records and filter semantics.

Phase 4 has no transition history. It can show who matches now, but cannot answer who matched on an earlier date or when a Client entered or left a Segment. Deactivating a saved Segment changes its saved status; it does not change source data or create membership history. Phase 4 has no campaign or other downstream consumer.

## Criteria AST and validation

The version 1 AST is a root group with operator AND or OR and conditions containing typed condition leaves or nested groups. A condition contains an allowlisted field, a type-compatible operator, and, where required, a value.

The server allows at most three group levels, 20 leaf conditions, 20 children per group, 100 selected values, 3,650 relative days, and 6,000 JSON characters. Groups cannot be empty. Unknown properties, unsupported versions, inactive fields/options, cross-tenant Tag IDs, incompatible operators, malformed dates, non-finite or out-of-range numbers, and invalid values are rejected before membership SQL runs. Tag and custom-field references are resolved from the current tenant's active catalog.

Supported operators are:

| Type | Operators |
| --- | --- |
| Text | equals, contains, starts_with, is_empty, is_not_empty |
| Number | equals, greater_than, greater_or_equal, less_than, less_or_equal, between, is_empty, is_not_empty |
| Boolean | is_true, is_false |
| Date | before, after, between, within_last, older_than, this_month, is_empty, is_not_empty |
| Single select / enum | equals, in, not_in, is_empty, is_not_empty |
| Multi-select | contains_any, contains_all, contains_none, is_empty, is_not_empty |
| Tag | has_tag, does_not_have_tag |
| Birthday | this_month, is_empty, is_not_empty |

Values are trimmed and bounded. Ranges have ordered endpoints. Dates are real YYYY-MM-DD calendar dates. Relative-day criteria keep the integer interval in the AST, not a date calculated at save time. Relative comparisons use the café's server-resolved IANA time zone and PostgreSQL's current date there: within_last(N) includes today and the preceding N−1 calendar dates; older_than(N) means strictly earlier than the date N days before today. For DATE fields, this_month compares against the current café-local calendar month. For the birthday month/day field, this_month compares the stored month regardless of year.

## Field registry

GET /tenant/crm/segments/fields returns metadata from an explicit server allowlist. Database identifiers and SQL mappings are private to the compiler; callers cannot send SQL or arbitrary ORM columns. The Client phone itself is not filterable or returned in field metadata. client.hasPhone exposes only a boolean presence check. Member and preview rows return a masked phone.

| Field | Type and meaning |
| --- | --- |
| client.name | Client first and last name combined for text matching. |
| client.status | Current ACTIVE or BLOCKED status. |
| client.hasPhone | Whether the Client phone is non-empty; never returns the phone value. |
| client.createdAt | Client creation calendar date in the café time zone. |
| crm.preferredSeating, crm.favoriteDrink | Explicit values on the Client's CRM profile. |
| crm.birthdayMonthDay | Explicit profile birthday stored as month/day, without a year. Supports month matching and empty checks. |
| tag | A current active Tag definition belonging to this café. |
| order.trackedCount | All current Orders for the tenant/Client, regardless of status. |
| order.deliveredCount | Current Orders with status DELIVERED. |
| order.canceledCount | Current Orders with status CANCELED. |
| order.knownSpendToman | Sum of total_amount_toman for current DELIVERED Orders only. |
| order.averageDeliveredValueToman | Delivered-only Known Spend divided by delivered count, rounded by PostgreSQL; null for zero delivered Orders. |
| order.firstOrderAt, order.lastOrderAt | Minimum/maximum Order created_at, including all current statuses. |
| order.lastDeliveredAt | Latest current DELIVERED Order's status_changed_at, falling back to created_at. |
| reservation.totalCount | All current Reservations. |
| reservation.completedCount, reservation.canceledCount, reservation.rejectedCount | Current status counts. |
| reservation.noShowCount | Reservations explicitly in NO_SHOW; elapsed time does not imply a no-show. |
| reservation.lastReservationAt | Maximum Reservation created_at, across statuses. |
| reservation.lastCompletedAt | Latest current COMPLETED Reservation's status_changed_at, falling back to created_at. |
| custom.FIELD_KEY | Active tenant definition, evaluated using its stored type and active option UUIDs. |

The Order measures use the Phase 2 Customer 360 definitions. Known UCafe Spend is stored offline payable value after recorded discounts, not proof of collection or all-café spending. Average delivered value uses the same delivered-only numerator and denominator as Customer 360. Reservation outcomes use current source status, not inferred history.

Custom TEXT, LONG_TEXT, and URL definitions map to text operators; NUMBER, BOOLEAN, and DATE retain their types; SINGLE_SELECT uses active option UUIDs; MULTI_SELECT uses active option UUID arrays. Date JSON values compare as ISO text, avoiding unsafe casts of malformed legacy values. Archived definitions and options are not silently reinterpreted: a stored Segment is preserved and listed with criteriaValid=false and an issue so an operator can edit or deactivate it. Catalog metadata omits inactive fields and options.

## Smart Groups

Smart Groups are fixed, named version 1 criteria presets. They share the same field catalog, validation, query compiler, preview, and paginated member query as saved Segments; they are not a second query engine and are not persisted.

| Key | Exact criteria |
| --- | --- |
| no-delivered-orders | Delivered Order count equals 0 (a Client may have non-delivered Orders). |
| repeat-customers | Delivered Order count is at least 2. |
| customers-with-no-shows | Explicit NO_SHOW Reservation count is at least 1. |
| birthdays-this-month | Stored birthday month equals this month in the café time zone. |
| lapsed-customers | Delivered Order count is at least 1 and latest delivered date is strictly older than 45 café-local calendar days. The 45-day value is a documented UCafe preset default; copying the group into a saved Segment allows an operator to edit the threshold. |

These labels describe only their stated current-data predicates. Phase 4 does not score Clients or claim that a group represents loyalty, value, risk, or campaign eligibility.

## Query and persistence strategy

The compiler starts every evaluation from clients c with mandatory c.coffee_shop_id = $1. Tenant ID is supplied only by the trusted tenant request context and never appears in the AST. Café time zone is separately parameterized. All values use PostgreSQL parameters; identifiers and expressions come only from the field registry.

The query left-joins the unique tenant/Client CRM profile. Tag and Custom Field rules compile to tenant-correlated EXISTS/NOT EXISTS. Order and Reservation metrics use separate correlated aggregate subqueries rather than joining multiple one-to-many relations, preventing Tag, Custom Field, Order, and Reservation join multiplication. Count and sample/member queries share the same compiled predicate. Preview returns total plus five masked sample rows; member routes count and paginate in PostgreSQL, ordered by Client creation time and ID.

Migration 1790620000000-TenantCrmSegments creates tenant_crm_segments with JSONB criteria, a tenant FK, creator membership FK, (coffee_shop_id,id) unique key, case-insensitive tenant-local name uniqueness, and tenant/update listing index. There is no tenant_crm_segment_members table. No source aggregate index was added without a representative query-plan review.

Integration coverage includes a PostgreSQL dynamic-membership and cross-tenant fixture with EXPLAIN. It passed during Phase 5 regression against the local development database. Correlated aggregates keep the query shape simple and correct; the small local fixture does not establish production-scale latency or plans, so review against representative tenant history before optimization.

## API and access

All routes require tenant_crm.read and effective tenant_crm entitlement. Create/update/deactivate additionally require tenant_crm.manage. Tenant scope is resolved from the authorized request context, not a client-supplied tenant ID. Foreign Segment IDs return 404.

| Route | Purpose |
| --- | --- |
| GET /tenant/crm/segments/fields | Active field, Tag, and Custom Field metadata. |
| GET /tenant/crm/segments?page=&pageSize=&q= | Paged saved Segment list, including criteria validity. |
| POST /tenant/crm/segments/preview | Preview unsaved criteria. |
| POST /tenant/crm/segments | Create a Segment. |
| GET /tenant/crm/segments/:segmentId | Read a tenant-owned Segment. |
| PATCH /tenant/crm/segments/:segmentId | Update name, description, criteria, or active status. |
| GET /tenant/crm/segments/:segmentId/preview | Re-evaluate saved criteria and return count/sample. |
| GET /tenant/crm/segments/:segmentId/clients?page=&pageSize= | Re-evaluate and return one member page. |
| GET /tenant/crm/smart-groups | List fixed preset definitions. |
| GET /tenant/crm/smart-groups/:key/preview | Preview a preset. |
| GET /tenant/crm/smart-groups/:key/clients?page=&pageSize= | Return a paged preset membership view. |

Page sizes are capped at 100; preview samples are capped at five. Client-facing APIs do not expose Segment records, criteria, or membership.

## UX and later use

The Tenant Admin workspace lives at /admin/crm/segments with presets at /admin/crm/smart-groups. The Persian RTL builder uses server field metadata, nested AND/OR groups, native value inputs, preview, paged member rows, and loading/error/empty states. It marks archived criteria unavailable while retaining them for repair. Existing CRM navigation links to both screens.

Future Campaign or Analytics work may consume a Segment as a current audience predicate after defining its own consent, eligibility, snapshot, and history semantics. Phase 4 does not implement any such integration, delivery, loyalty, automation, scoring, or analytics.

## Phase 5 boundary

Loyalty adds no criteria field, stored membership, or automatic Segment recalculation. Segment filters continue to use current Client, CRM, Order, and Reservation sources only. A later phase may define a points-balance filter or loyalty audience independently after measuring query cost and specifying membership freshness/history semantics.

## Phase 6 boundary

Feedback count, average rating, negative count, latest Feedback time, and Needs Attention count are not Segment fields in Phase 6. The current registry remains unchanged; future work must define typed operators and confirm a tenant-scoped aggregate query before adding Feedback criteria.


## Phase 7 Offer targeting

Offer preview and activation reuse the saved Segment criteria compiler and the tenant's current field catalog. Preview is a current estimate. Activation takes a one-time snapshot of matching Clients and records the Segment name and criteria used. Later Segment or Client changes do not recalculate that Offer's audience; a new Draft and activation are required for a new audience.

## Phase 9 Automation conditions

Automation definitions validate their criteria through this same typed, bounded compiler. At execution start, current Client, CRM profile, Tag, Custom Field, Order, and Reservation values are queried for the execution's tenant and Client; no member list is copied. Supported event conditions come from a separate trigger-specific event-field allowlist and use the immutable source-event snapshot. This does not create Segment enter/exit events, saved membership, or historical membership analytics.
