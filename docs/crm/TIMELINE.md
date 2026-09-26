# Unified CRM Timeline

**Status:** Implemented in Phase 5 and extended in Phase 6. The Timeline and Organization 360 are derived read views; neither is a persisted CRM entity.

## Source-of-truth rule

Timeline represents durable source records and histories. It does not replace or copy Lead, Deal, Activity, Task, Note, Tenant, Trial, Subscription, Plan, or Payment state. No Timeline table, materialized view, event bus, or historical projection backfill exists.

| Timeline content | Read source | Occurrence time |
|---|---|---|
| Lead created | `crm_leads` | `created_at` |
| Lead status, qualification, unqualification, conversion | `crm_lead_status_history` joined to the current Lead/Organization relationship | history `created_at` |
| Deal created | `crm_deals` | `created_at` |
| Deal stage changed | `crm_deal_stage_history` (initial `from_stage IS NULL` row omitted) | history `created_at` |
| Deal won/lost | `crm_deals` outcome and `won_at`/`lost_at`; the matching transactional audit row supplies the actor | `won_at` or `lost_at` |
| Activity | `crm_activities` | `occurred_at` |
| Task created | `crm_tasks` | `created_at` |
| Task completed, canceled, reopened | Only `crm.task.completed`, `crm.task.canceled`, and `crm.task.reopened` rows in `platform_audit_events` joined to the Task | audit `created_at` |
| Note | `crm_notes` | `created_at` |
| Tenant created | linked/current or historically linked `coffee_shops` row | `created_at` |
| Tenant linked/unlinked | transactional `crm.organization.tenant_linked` / `crm.organization.tenant_unlinked` audit row | audit `created_at` |
| Trial started | linked/current or historically linked `subscriptions` row | `trial_started_at` |
| Subscription activated/renewed/reactivated/Plan changed | successful non-legacy `subscription_payments` row | `paid_at` |

The Task lifecycle audit actions are recorded in the same transaction as each Task state transition and retain repeated complete/reopen cycles that the current Task row alone cannot show. Deal status cannot be reopened; Deal fields retain its terminal timestamp, and its single matching audit action supplies actor attribution. No other audit action is included. Audit summaries stay free of Task or Note content.

## Item contract

`GET /api/v1/platform/crm/organizations/:organizationId/timeline` returns `{ items, total, page, pageSize }`. Each item has:

```text
id, type, category, occurredAt,
actor { userId, label, kind }, title, description?,
organizationId, contactId?, leadId?, dealId?,
sourceType, sourceId, metadata?
```

IDs are stable and event-specific: for example `activity:<activityId>`, `lead-status:<historyId>`, `deal-stage:<historyId>`, `task-lifecycle:<auditId>`, and `note:<noteId>`. The same Deal/Task may therefore contribute distinct creation, transition, and outcome items. Actor labels follow the CRM's masked Platform User convention. A null actor is never replaced by a fake User; an initial `LANDING_FORM` Lead is labeled as coming from the public consultation form.

Stable types are `LEAD_CREATED`, `LEAD_STATUS_CHANGED`, `LEAD_QUALIFIED`, `LEAD_UNQUALIFIED`, `LEAD_CONVERTED`, `DEAL_CREATED`, `DEAL_STAGE_CHANGED`, `DEAL_WON`, `DEAL_LOST`, `ACTIVITY_LOGGED`, `TASK_CREATED`, `TASK_COMPLETED`, `TASK_CANCELED`, `TASK_REOPENED`, and `NOTE_ADDED`. Deal reopen and Note update events are not emitted: closed Deals are terminal, and Notes have no immutable edit history. A Note is one Timeline item using its original creation time and current source body, not a second note-update event.

Phase 6 adds `TENANT_CREATED`, `TENANT_LINKED`, `TENANT_UNLINKED`, `TRIAL_STARTED`, `SUBSCRIPTION_ACTIVATED`, `SUBSCRIPTION_RENEWED`, `SUBSCRIPTION_REACTIVATED`, and `SUBSCRIPTION_PLAN_CHANGED` under category `CUSTOMER`. Subscription payment metadata contains only its operation and paid period end; it never includes amount, provider reference, or gateway details. Trial metadata may include its end date. A Tenant link uses the current unique link plus explicit link/unlink audit history to retain the customer context after unlink. Only durable timestamps are shown: CRM does not fabricate Tenant status transitions or Trial expiry, grace, suspension, cancellation, or scheduled Plan-change events because those histories are not persisted.

Categories are `LEAD`, `DEAL`, `ACTIVITY`, `TASK`, `NOTE`, and `CUSTOMER`. Structured metadata carries source keys such as previous/next Lead status, Deal stages/outcome/loss reason, Activity type/outcome, Task status transition, Note `updatedAt`, Tenant ID, Trial end, or paid Subscription operation/period end. The API does not store translated presentation sentences. The Persian UI localizes stable type and metadata values and falls back to a generic CRM event for unknown future types.

## Organization association and deduplication

Every source branch scopes against the requested Organization ID. CRM records use direct Organization, Contact, Lead, and Deal relationships; customer records use only the current Organization/Tenant link or a durable CRM link/unlink audit association. Records are never matched by name, phone, email, slug, or hostname. Phase 4 same-Organization constraints ensure combined CRM relationships agree. Lead-only work created before conversion becomes visible after the Lead is linked to its Organization because the read joins the Lead's current `organization_id`; its original occurred time is unchanged.

Each Activity, Task, and Note is selected from its source row once, even when it has multiple links to the same Organization. Related archived records are not removed from history. Archived Organizations remain readable to an authorized `crm.read` user. Hard deletion remains constrained by CRM foreign keys.

## Ordering, filtering, and pagination

The implementation uses one PostgreSQL `UNION ALL` query with source-specific filters, a count, and one requested page; it does not load full history into application memory. Page defaults to 1, `pageSize` defaults to 20 and is capped at 100. Offset pagination follows current CRM list conventions. Stable order is `occurredAt DESC`, then `category ASC`, then item ID ascending, so equal timestamps keep their order across pages. Event identity is source/event-specific, preventing overlap between distinct events on one record.

Optional `category` accepts one of the six categories. Optional ISO `dateFrom` is inclusive and `dateTo` is exclusive (`occurredAt >= dateFrom`, `occurredAt < dateTo`); reversed ranges are rejected. The UI sends local midnight and the next local midnight for date controls, so daylight-saving/date-boundary behavior follows the operator's browser. Filters are applied in each source branch before union ordering/pagination.

## Organization 360

`GET /api/v1/platform/crm/organizations/:organizationId/overview` composes a bounded view over existing sources. It returns:

- active Contact count, total linked Lead count, active Deal count, active open Deal count, and active open Task count;
- the most recent active Activity and next open Task, both derived at read time;
- up to six linked Leads and Deals (including archive markers), up to six open Tasks, six recent active Activities, and six recent active Notes.

The Contact directory remains separately paginated and retains its existing archive/search/edit flow. Overview sections are read with a fixed number of bounded queries, not one query per record. Each query may fail independently; `sectionErrors` names failed sections while successful sections remain available. Summary counts use `null` when their query fails. Activity and Note previews omit archived rows; Timeline retains historical archived sources.

The UI keeps the existing Organization header and Contact/work flows, adds an operational summary, related Lead/Deal lists, open Task and recent Activity/Note previews, and embeds the paginated Timeline. Quick actions reuse Phase 4 Activity/Task/Note forms. An archived Organization remains a historical read view; existing manage controls stay disabled.

## Authorization, UX, and future scope

Overview requires `AccessTokenGuard`, `PlatformPermissionGuard`, and `crm.read`. Customer context and Timeline require `crm.read` plus `subscriptions.read`; the limited read permission is separate from subscription management and omits financial/provider details. Assignment is not a visibility filter. The Timeline reads only the explicit customer facts listed above and is not a generic audit feed. Tenant status changes remain absent because the source has no durable status history.

Timeline is Persian-first, RTL, responsive, and keyboard accessible. Category and local-day date filters use labeled native controls; type markers include text/shape cues beyond color, long content can expand, and errors/loading/empty states are contained to each overview or Timeline section.
