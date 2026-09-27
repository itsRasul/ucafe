# Platform CRM Workflow Automation

Phase 9 adds a bounded operational automation tool for platform CRM. A Workflow is configuration; an event records something that already happened; an execution records a Workflow's response. Workflows do not own Lead, Deal, Task, Tag, Tenant, Trial, or Subscription lifecycles.

## Model and lifecycle

- `crm_workflows` stores name/description, typed trigger and config, condition record type plus the Phase 7 filter AST, an ordered JSON action list, enabled state, version, user metadata, and archive timestamp.
- `crm_workflow_events` is a CRM-specific transactional outbox. A source service inserts a compact PII-free event in the same transaction as its domain change. `source_key` is unique; scheduled work uses a stable key from its source record and date.
- `crm_workflow_executions` records one matched Workflow/event pair, a unique `(workflow_id,event_id)`, workflow version/config snapshot, record identity, status, correlation/depth, and sanitized failure details. Condition misses are intentionally not logged.
- `crm_workflow_action_executions` snapshots each ordered action config and records attempt/status/result metadata. A failed action stops the chain; earlier successful actions remain complete.

Workflows begin disabled. `PATCH` can enable or disable them; archive disables and hides a Workflow while its execution history remains. Editing increments the version. The snapshot stored on an execution remains stable after later edits. Up to 100 Workflows can be enabled and each may contain 1–10 actions.

## Triggers and conditions

The supported trigger keys are `LEAD_CREATED`, `LEAD_QUALIFIED`, `LEAD_CONVERTED`, `LEAD_STATUS_CHANGED`, `DEAL_CREATED`, `DEAL_STAGE_CHANGED`, `DEAL_WON`, `DEAL_LOST`, `ACTIVITY_CREATED`, `TASK_COMPLETED`, `LEAD_SCORE_CHANGED`, `LEAD_SCORE_CROSSED_THRESHOLD`, `TASK_OVERDUE`, and `TRIAL_ENDING`.

Transition triggers accept only allowlisted prior/next status or stage values. A score threshold fires only when a non-null prior Overall score crosses the configured integer threshold in the selected direction. A Lead's first score has no previous score and does not count as a crossing.

Conditions use `CrmFilterService` and the existing flat version-1 `AND`/`OR` criteria model, including active core fields, Tags, custom fields, and Lead score/Activity fields. Supported condition records are Organization, Lead, and Deal; the event must contain that related record ID. `TRIAL_ENDING` conditions must target an Organization. Transition values stay in typed trigger configuration/context, not in a second filter language. Segment membership, Contact criteria, nested groups, and arbitrary SQL/code are not supported.

## Actions

- `CREATE_TASK` creates a regular CRM Task linked to the condition record, due 1–365 days after the trigger, with a selected priority/kind and either unassigned, record-owner, or specific-user assignment. Organizations have no CRM owner, so their Tasks must be unassigned or assigned to a specific active CRM user.
- `ADD_TAG` and `REMOVE_TAG` operate on an active Tag and the condition record. Repeated add/remove requests are no-ops.
- `ASSIGN_LEAD_OWNER` and `ASSIGN_DEAL_OWNER` require a Lead or Deal condition record and an active CRM user. Reassigning to the current owner is a no-op.

All action shapes and referenced Tags/users are validated before saving. Execution revalidates current dependencies; a stale reference fails visibly instead of being silently ignored. There is no template expression evaluation, custom-field mutation, Note action, campaign messaging, Webhook, notification, billing mutation, or user-defined code.

If revalidation fails before action rows can be safely created, the execution is recorded as failed with a generic configuration error and has no retryable action. Correct the Workflow for later events; manual retry applies only when an action execution is present and failed.

## Runtime and reliability

The API process polls every five seconds. It claims one event/action at a time with PostgreSQL row locks and `SKIP LOCKED`; multiple API replicas can safely claim distinct work. Events are committed with the source transaction, so a restart does not lose pending work. Events stale by `claimed_at` and actions stale by `started_at` are recovered after five minutes, a 60x margin over the poll interval. This is safe for the current short, database-only dispatch/action transactions; long-running external actions would require a lease extension before they are introduced. Stale claims count as attempts: attempts below three return to `PENDING`/`RETRYING` for immediate reclaim, while the third stale claim becomes terminal `FAILED`. That cap also applies when a process dies repeatedly; terminal rows are not selected again. There is no new broker, Redis queue, worker process, or separate scheduler framework.

Execution uniqueness prevents a replayed event from creating a second execution for the same Workflow. Each action and its CRM mutation commit in one database transaction. Tasks also have a unique `automation_action_execution_id`; Tag and owner operations are no-op safe. Retrying an execution resumes at the first failed action, preserving earlier successful action records.

An event with no enabled matching Workflow, a false condition, or only disabled candidates still completes as `PROCESSED`; condition misses do not create execution rows. `ADD_TAG`/`REMOVE_TAG` and owner no-ops are successful action results. A stale action recovery also updates the parent execution to `RETRYING` or `FAILED`, so analytics and execution detail agree with the action state. Recovery diagnostics use only the rows returned by PostgreSQL, include event IDs/type/attempt/status, and cap the ID list at ten per warning; an empty recovery produces no warning.

Source events retry only for recognized transient PostgreSQL/connection failures: three total attempts (the first plus two retries), delayed by 2 and 10 seconds. Permanent errors fail immediately. Actions use the same bounded retry policy. Stale recovery consumes the already-incremented claim attempt and never resets it; it makes a crashed attempt immediately eligible again but still fails the event/action at the same maximum. After automatic failure, `crm.manage` can request up to three manual retries per failed action. Error codes/messages are deliberately generic and exclude SQL, user text, PII, and secrets.

Workflow actions set transaction-local correlation, causation, and depth context. Events caused by an action inherit the correlation ID, reference the parent Workflow execution, and increment depth. Events at depth 5 are marked `LOOP_BLOCKED`; no further Workflow runs from them. No-op Tag and owner actions avoid unnecessary writes/events.

## Scheduled triggers

One API scanner runs at most once per minute under a PostgreSQL advisory transaction lock. It reads at most 1,000 due rows per sweep. `TRIAL_ENDING` scans active CRM Organizations linked to active Tenants whose authoritative Subscription is `TRIALING`, inside the configured 1–30 day window. Stable keys include Workflow, Subscription, and trial-end timestamp. `TASK_OVERDUE` scans active OPEN Tasks with due dates and uses Task ID plus due timestamp as its stable key. These scanners only enqueue CRM events; they never mutate a Subscription or Task. There is no organization owner field, so Trial-ending follow-up must target a specific user or be unassigned.

## API and permissions

All routes are platform-only behind `AccessTokenGuard` and `PlatformPermissionGuard`:

- `crm.read`: list/read Workflows, read execution lists/details.
- `crm.manage`: create/update/enable/disable/archive Workflows and manually retry failed executions.
- Tenant identities cannot call these Platform routes.

See [API.md](API.md) for route and payload examples. The Persian RTL UI uses the CRM filter builder, ordered action controls, execution history, sanitized failure detail, and retry action. `createdByAutomation` marks Tasks created by a Workflow.

## Data retention and limitations

Execution/event history is retained without an automatic purge so Phase 10 can measure success/failure and automation-created Tasks. A production retention policy and archival operation must be chosen before volume grows materially. There is no dry-run/preview mode. The scanner caps one sweep at 1,000 rows, and API polling performs bounded batches (25 events and 50 actions); move to a dedicated durable worker or larger batches only when measured throughput requires it.

Phase 10 may aggregate execution counts, success/failure rates, automation-created Tasks, and later conversion outcomes. Analytics must read this history; the runtime does not depend on Analytics. The Sales Engine remains out of scope.
