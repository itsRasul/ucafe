# Platform CRM Filtering

CRM list filters run in PostgreSQL before pagination. The same bounded criteria compiler is used for list queries, Saved Views, Segment previews, and Segment record pages.

## Contract

```json
{
  "version": 1,
  "logic": "AND",
  "conditions": [
    { "field": "city", "operator": "equals", "value": "Tehran" },
    { "field": "tags", "operator": "containsAny", "value": ["tag-uuid"] },
    { "field": "custom:number_of_branches", "operator": "gte", "value": 2 }
  ]
}
```

The AST is flat, allows `AND` or `OR`, and has a 20-condition cap. It does not accept nested groups. A list request sends it in the `filter` query parameter; Saved Views and Segments store the JSON object. Query strings over 6,000 characters are rejected. Existing resource query DTOs still own search, relationship, status, date-range, archive, and sort parameters.

`GET /platform/crm/filter-fields?entityType=...` returns the allowed filter fields, labels, types, operators, and active select/Tag choices. Fields are explicitly registered per entity. The compiler rejects unknown fields, unsupported operators, malformed values, invalid option ownership, and unknown condition properties. User values use PostgreSQL bind parameters; client input never becomes a column name or SQL fragment.

## Types and fields

Text fields support equality, inequality, contains, prefix, and empty checks. Numbers support comparisons, ranges, and empty checks. Dates support exact/before/after/range and empty checks. Booleans support true/false. Select fields support equality, inequality, `in`, and empty checks. Multi-select fields and Tags support `containsAny`, `containsAll`, `containsNone`, and empty checks.

The base registry exposes only operational CRM fields and explicitly approved relationships. Organization, Contact, Lead, and Deal custom fields are read from their record's JSONB object using a bound key. Tag matches use indexed explicit target-FK assignments. Archived Tags remain assigned and visible on records, but they are excluded from active Tag filters.

Lead filters also expose score values (`fitScore`, `engagementScore`, `overallScore`, `scoreCalculatedAt`) and bounded Activity signals (`activityCount`, `lastActivityAt`, `daysSinceLastActivity`, `hasDemoActivity`, `hasConnectedCall`). `daysSinceLastActivity` compares with the current database time in list/Segment queries and with one captured evaluation time during scoring. Activity signals exclude archived rows; the derived day count is null when no matching Activity exists. These fields are queryable filters, not scoring inputs for rules (score fields are explicitly rejected there).

The current Organization customer-context field is `tenantLinked`. Full effective Subscription status, Trial state, and current Plan remain unavailable to Lead scoring and filters: those values belong to the Subscriptions module and its effective lifecycle includes time-sensitive rules and pending Plan changes. CRM does not copy that state or maintain a second calculation. Relative-date operators beyond the explicit Activity-derived Lead fields remain unsupported.

## Saved Views and URL state

Saved Views combine the AST with an allowlisted ordinary query definition and supported core sort. Lead score fields are valid filter criteria and score fields can be selected as Lead sorts. Selecting a view updates the list and URL's `savedView` parameter; refreshing reruns the view against current data. Ad-hoc filter-builder state remains local until saved. Custom-field sorting and visible-column preferences are not implemented.

## Performance boundaries

Tag assignment indexes cover each explicit entity FK and Tag ID. The migration adds no index per custom field; filters remain bounded and use server pagination, while dynamic Segment counts use database `COUNT`. JSONB values are not duplicated into CRM columns or materialized Segment membership. Review representative `EXPLAIN` plans against production-scale CRM volumes before adding a fixed GIN/expression index strategy or raising the condition cap.

## Workflow conditions

Workflow conditions call the same `CrmFilterService.compile` path as Phase 7 list views, Saved Views, Segments, and scoring. They use one flat version-1 AND/OR AST with a 20-condition cap, current core fields, active Tags/custom fields, and Lead score/Activity fields. The condition record is explicitly Organization, Lead, or Deal and is evaluated against its current source row with the related Organization join. That related record ID must be present in the event's bounded record context.

Transition values (such as previous/new Deal stage or previous/current score) stay in typed trigger configuration/context; the Workflow does not accept them as arbitrary filter columns. Segment membership, Contacts, nested groups, and raw SQL are not supported. Stale field/Tag/user dependencies are rejected on save or fail with sanitized configuration errors during execution.
