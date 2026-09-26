# CRM Activities

**Status:** Implemented in Phase 4 by migration `1790540000000-CreatePlatformCrmWorkRecords`.

An Activity records an interaction that already happened. It is separate from future work (Task), contextual prose (Note), Lead/Deal lifecycle history, and provider/system events.

## Fields and types

`crm_activities` stores a UUID, `activity_type`, required `subject`, optional plain-text `details`, required UTC `occurred_at`, optional type-specific `outcome`, optional Organization/Contact/Lead/Deal foreign keys, the performing/logging Platform User, updater/archive actors, timestamps, and `archived_at`.

Supported types are `CALL`, `MEETING`, `DEMO`, `EMAIL`, `SMS`, `WHATSAPP`, and `OTHER`. Call outcomes are `CONNECTED`, `NO_ANSWER`, `BUSY`, `CALL_BACK_REQUESTED`, `NOT_INTERESTED`, `INTERESTED`, `INVALID_NUMBER`, or `OTHER`. Meeting/demo outcomes are `COMPLETED`, `CANCELED`, `NO_SHOW`, `RESCHEDULED`, or `OTHER`. Other types have no outcome. DTO and database checks enforce the mapping.

`occurredAt` is the time of the interaction, not the time a staff member entered it. Past timestamps are valid; future timestamps are rejected. `actorUserId` identifies the Platform User who logged/performed it. Actor names are returned as masked labels.

## Associations and conversion

At least one explicit Organization, Contact, Lead, or Deal reference is required. Multiple references are allowed when they describe the same business context. For example, an Activity may refer to an Organization, its Contact, and its Deal. Contact, Deal, and linked Lead Organizations must agree. The service checks parent rows under share locks; composite foreign keys also enforce Organization consistency. Archived records cannot receive new or changed work.

A Lead-only Activity is valid before conversion. It remains attached to that Lead; after conversion, list projections resolve its now-linked Organization so it also appears in the Organization's Activity section. There is no generic polymorphic key and no Activity-to-Task foreign key.

## Changes and retention

`crm.manage` can create, edit, archive, and restore Activities. Editing is allowed while active. Archiving hides a row from default lists but retains its content and associations; no hard-delete endpoint exists. Archive/restore are idempotent. The audit row commits in the same transaction as each mutation and never copies the subject/details.

The API orders by `occurredAt` by default and supports type, outcome, actor, association, occurred-time range, text search, archive state, and pagination. See [API.md](API.md).

## Future Timeline

Activities are relational source records for the Phase 5 Unified Timeline. They are not a pre-aggregated stream, DealStageHistory, LeadStatusHistory, audit event, or external communication proof. Phase 4 does not publish them to an event bus.
