# CRM Segments

A Segment is a named, dynamic grouping of one supported record type. It stores its criteria, not member IDs. Each preview, count, and page query evaluates against current Organizations, Contacts, Leads, or Deals, so changes to source records change membership without a synchronization job.

## Segment lifecycle

CRM managers create, update, and archive Segments. CRM readers can list them, preview unsaved criteria, inspect a saved Segment, and read its paginated members. Definitions and current matching records are available through:

- `GET/POST /platform/crm/segments`
- `GET/PATCH /platform/crm/segments/:id`
- `POST /platform/crm/segments/:id/archive`
- `POST /platform/crm/segments/preview`
- `GET /platform/crm/segments/:id/preview`
- `GET /platform/crm/segments/:id/records?page=1&pageSize=25`

The Platform UI provides a shared filter builder, live preview, criteria summary, a Segment detail page with current count and paged record links, and an edit link back to the criteria form. Membership is not a campaign audience. There are no bulk messages, workflow actions, or persisted membership snapshots.

Saved Views and Segments share one filter AST but have different purposes. A Saved View restores a user's CRM list filters and sort; a Segment names a business grouping for repeated operational use and future phases.

## Criteria lifecycle and current limits

Criteria are revalidated when loaded. If an active custom field or Tag used by criteria is archived, the Segment is reported as invalid and its detail explains that criteria need repair. Membership is not silently broadened. Segment counts and records use the same current-data query.

Lead Segments may filter by persisted Fit, Engagement, and Overall scores and the supported Activity aggregates. Lead score fields can also be used in Saved Views. Score rules cannot depend on scores, preventing circular evaluation; Segments and Saved Views are still ordinary dynamic queries and do not change score calculation.

The current filter registry supports Organization Tenant linkage (`tenantLinked`) but not projected current Plan, effective Subscription status, or Trial state. Those facts remain authoritative in the Subscriptions module and CRM has no query projection that can reuse its effective-status lifecycle calculation safely. Nested Boolean groups, custom-field sorts, and static membership remain unsupported.

Workflows do not depend on Segment membership. They evaluate the existing filter AST against an event's current Organization, Lead, or Deal record. Segment entry is not an event because Segments are live queries with no persisted membership transition; supporting it would require a separately designed and bounded membership-change contract.
