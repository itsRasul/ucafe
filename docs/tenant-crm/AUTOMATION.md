# Tenant CRM lifecycle automation

Phase 9 stores café-owned lifecycle rules and their execution history. Definitions use the existing `tenant_crm` entitlement, tenant context, `tenant_crm.read`, and `tenant_crm.manage`. The page is `/admin/crm/automations`; endpoints are under `/tenant/crm/automations`. Every query, source relationship, tag, assignee, execution, and side effect is scoped to the resolved café.

## Supported triggers

| Trigger | Durable source / occurrence | Conditions |
| --- | --- | --- |
| `ORDER_DELIVERED` | `tenant.order.delivered` in the transactional Order outbox; one execution per source event | Current Client/CRM/Order/Reservation/Tag/Custom Field criteria plus snapshotted delivered-order amount |
| `FEEDBACK_CREATED` | Feedback-created row in the same transaction; one execution per feedback event | Current state plus snapshotted rating and source |
| `FEEDBACK_RESOLVED` | Feedback-resolution row in the same transaction; one execution per feedback event | Current state plus snapshotted rating and source |
| `CLIENT_LAPSED` | Café-local scan; `LAPSED:<clientId>:<lastDeliveredAtMillis>` | Active Client, at least one delivered Order, no delivery within configured 1–3650 days, plus optional current CRM criteria |
| `CLIENT_BIRTHDAY` | Café-local scan; `BIRTHDAY:<clientId>:<localDate>` | Active Client whose stored birthday month/day is today, plus optional current CRM criteria |

Only supported event sources fire rules. Client creation and Reservation transitions do not yet have a dependable durable source contract and are omitted. Dynamic Segment membership has no enter/exit history; automation does not invent such events. Event criteria are limited to a small typed event snapshot. All other criteria use the Phase 4 field allowlist/compiler and evaluate against current state at execution start. A false condition ends as `SKIPPED` and performs no actions.

## Actions and exclusions

Actions run sequentially and are restricted to `ADD_TAG`, `REMOVE_TAG`, `CREATE_REMINDER`, and `ADD_NOTE`. Tag actions reference an active same-café Tag. Reminder assignees must be active users in that café; a due-day offset is interpreted in café-local calendar time. Automation-created Notes and Reminders are explicitly attributed to their action execution, not impersonated as a User. Every action effect and its `SUCCEEDED` state commit in one transaction; action IDs provide replay-safe side-effect keys.

No SMS, WhatsApp, email, push notification, offer grant, Promotion mutation, Loyalty balance mutation, arbitrary HTTP, SQL, executable code, or custom action is available. Phase 8 remains deferred until tenant-funded SMS billing, wallet, or quota exists. Phase 9 does not depend on communications. The UI is a guided form and ordered action list, not a free-form workflow canvas.

## Lifecycle and snapshots

Definitions have `DRAFT`, `ACTIVE`, `PAUSED`, and `ARCHIVED` states. Only active rules receive new triggers. Activation records a new `activated_at`; older queued source events are not replayed. Pausing stops new intake while already-created executions finish from their definition snapshots. Editing increments the version; executions retain the version, conditions, action configs, and minimal trigger data captured when the execution is created. Archived definitions cannot be edited or reactivated. A café may have up to 100 active definitions.

Each execution is unique by `(coffee_shop_id, automation_id, occurrence_key)`. Source event IDs also have stable outbox keys. The outbox has an independent automation dispatch status so Loyalty's Order consumer and Tenant CRM do not claim or complete one another's work. Existing outbox events are marked processed during migration to prevent historical backfill.

## Processing and failure handling

The API process polls every five seconds. `FOR UPDATE SKIP LOCKED` claims source events, executions, and one sequential action at a time. A database advisory transaction lock coordinates the café-local time scan across API instances. Event/execution/action claims older than five minutes are recovered; stale attempts count toward the three-attempt limit and never reset. Transient database failures use short bounded delays. Permanent validation/configuration failures are terminal and store only a safe error code/message. Source payloads contain IDs and minimal trigger values, not phone, comment, note, or customer identity fields.

Order events carry correlation, causal execution ID, and depth through the source transaction. Repeated automation ancestry creates a terminal `LOOP_BLOCKED` execution for diagnostics; an event at depth five is terminally blocked in the outbox. Actions do not currently emit any supported CRM trigger. Source modules remain operational when the CRM feature is disabled; the CRM consumer marks those events complete without creating executions. Already-created executions recheck effective `tenant_crm` before applying any action.

Time scans fairly rotate through at most 100 active time automations and 100 candidates per automation in a pass using a persisted scan timestamp. A single shared scan lock is sufficient for current volume; tenant sharding should be considered after measurements show contention. Stale-claim indexes and partial dispatch indexes support worker selection/recovery.

## API

All tenant admin routes require access token, trusted tenant context, effective `tenant_crm`, and tenant permission checks. Reads require `tenant_crm.read`; definition changes, transitions, metadata for building, and previews also require `tenant_crm.manage`.

| Method / route | Contract |
| --- | --- |
| `GET /tenant/crm/automations` | Filtered, paginated definitions |
| `GET /tenant/crm/automations/metadata?triggerType=...` | Active Tags/users and trigger-specific Phase 4 field metadata |
| `GET /tenant/crm/automations/:automationId` | Tenant-owned definition |
| `POST /tenant/crm/automations` | Create a validated Draft |
| `PATCH /tenant/crm/automations/:automationId` | Update a non-archived definition and increment its version |
| `POST /tenant/crm/automations/:automationId/activate` | Validate and activate from current time |
| `POST /tenant/crm/automations/:automationId/pause` | Stop future intake; existing runs continue |
| `POST /tenant/crm/automations/:automationId/archive` | Archive a Draft or Paused definition |
| `POST /tenant/crm/automations/preview` | Count matching Clients for supported time triggers |
| `GET /tenant/crm/automations/:automationId/executions` | Paginated execution history |
| `GET /tenant/crm/automations/executions/:executionId` | Execution snapshot, safe errors, and ordered action statuses |

There is no arbitrary/manual `/run` endpoint. Definition, condition AST, config keys, sizes, ranges, active Tag IDs, and assignee memberships are server validated. Client/automation foreign IDs return not found without leaking tenant ownership.

## Persistence

Migration `1790660000000-TenantCrmAutomation` creates `tenant_crm_automations`, `tenant_crm_automation_executions`, and `tenant_crm_automation_actions`; gives the existing `domain_event_outbox` an independent automation dispatch channel and causal metadata; and adds an automation action source to Tags, Notes, and Reminders. Tenant-composite constraints protect all relationships. Side-effect constraints require either a human creator or an automation action, never a fabricated human actor.

## Verification and limits

See [TESTING.md](TESTING.md) for the required database scenarios. Authenticated visual acceptance requires an active Tenant Admin session; the repository does not have a browser E2E suite. Scanner limits, retries, and event set are intentionally narrow and must be revisited before introducing communication actions, higher volume, or additional trigger families.
