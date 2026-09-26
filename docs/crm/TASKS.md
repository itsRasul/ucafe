# CRM Tasks and follow-ups

**Status:** Implemented in Phase 4 by migration `1790540000000-CreatePlatformCrmWorkRecords`.

A Task represents future or outstanding work. `FOLLOW_UP` is a Task kind, not a separate FollowUp entity. Completing a Task never creates an Activity; staff logs the historical interaction separately when it occurs.

## Fields and assignment

`crm_tasks` stores a UUID; required title; optional plain-text description; kind `GENERAL|FOLLOW_UP`; status `OPEN|COMPLETED|CANCELED`; priority `LOW|NORMAL|HIGH|URGENT`; optional UTC `due_at`; optional assigned Platform User; explicit optional Organization/Contact/Lead/Deal references; creator/updater; completion and cancellation time/actor; archive actor/time; and timestamps.

Assignees must be active Platform Users with CRM access, reusing Lead assignment validation. Assignment is workload ownership, not record access control. API output uses masked assignee labels.

At least one CRM association is required. Multiple references must belong to the same Organization. A Lead-only Task is allowed before conversion; after Lead conversion, Organization list projections resolve the Lead's canonical Organization and expose its Tasks there. A contact-only or deal-only row still has a real Organization because those records are organization-owned.

## Lifecycle

- New Tasks are `OPEN`. Only OPEN Tasks can be edited, completed, or canceled.
- Completion atomically sets `COMPLETED`, `completed_at`, and `completed_by_user_id`.
- Cancellation atomically sets `CANCELED`, `canceled_at`, and `canceled_by_user_id`.
- Either terminal status can be explicitly reopened. Reopening clears the previous terminal timestamp/actor and is audited.
- An OPEN Task cannot be archived. A completed or canceled Task may be archived and later restored. Archive is retention/filtering, not cancellation.
- `overdue` is derived on read as `status=OPEN AND due_at < database now()`. It is never persisted; a null due date is not overdue.

Due dates are timezone-safe `timestamptz`. CRM follows UCafe's existing timestamp convention; the browser supplies local-day boundaries for Today and renders times in the user's browser locale. The backend accepts explicit half-open `dueFrom`/`dueTo` filters.

## Views and follow-up UX

`/platform/crm/tasks` provides Today, Overdue, Upcoming, All Open, and Completed views, search, assignee (including Me and Unassigned), priority filters, quick completion/cancellation/reopen, pagination, and related-record links. Today sends the browser's local start of day inclusive and next local day exclusive, with the server still restricting results to OPEN. Upcoming means OPEN with a due time after now. Tasks with no due date remain in All Open and have an API `NO_DUE_DATE` view.

Organization, Contact, Lead, and Deal details provide a quick `پیگیری` action. It creates a normal Task with kind `FOLLOW_UP`, a suggested record-based title, and the same association checks as any Task. Due time, priority, description, and assignee remain editable. No cron, reminder notification, automated sequence, or next-follow-up cache is created.

## Retention and audit

Completed/canceled Tasks remain queryable and are not deleted. Each consequential mutation and its `platform_audit_events` row commit in one transaction. Audit summaries contain lifecycle/category metadata, never the Task title or description. See [API.md](API.md) and [EVENTS.md](EVENTS.md).
