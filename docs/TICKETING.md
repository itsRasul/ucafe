# Support Ticketing architecture

**Status:** Phase 1 core backend implemented on 2026-09-29. Ticket persistence, tenant/platform APIs, permissions, and lifecycle transitions are in place. UI, attachment storage, SMS delivery, and auto-close scheduling remain deferred. Product status remains in [PRD.md](PRD.md).

## Goals and non-goals

Ticketing will provide a durable support conversation between tenant administrators and authorized UCafe platform staff. It reuses the existing administrative User identity, tenant context, Platform RBAC, PostgreSQL, private S3-compatible storage, and SMS outbox.

Phase 0 recorded the design only. Phase 1 implements tenant and Platform ticket CRUD/replies, manual close/reopen, and transactional message persistence. Ticketing is available across subscription plans and is not a plan feature. Phase 1 does not queue or send SMS; NotificationsService integration belongs to Phase 5 so this core phase cannot trigger delivery early.

## Existing infrastructure to reuse

| Concern | Existing UCafe pattern | Ticketing direction |
| --- | --- | --- |
| API | NestJS domain modules, DTOs, services, TypeORM entities, forward migrations | Add one support module under the existing REST route groups |
| Tenant identity | Host-derived TenantContext uses coffeeShopId; tenant guards require active membership and database permissions | Store coffeeShopId on Ticket; derive it from trusted context on tenant requests |
| Admin identity | users is shared by tenant staff and platform operators; cafe clients are separate | Use User IDs for creator and human senders; do not add a Ticket user model |
| RBAC | Database-backed scope-separated permissions and guards | Add support permissions to the existing catalog and role assignments |
| SMS | sms.ir provider; encrypted notification_deliveries outbox, deduplication, bounded retries | Enqueue typed events through NotificationsService; never send SMS in a Ticket transaction |
| Storage | Private MinIO/S3 bucket and MediaStorageService; generated tenant object keys; API streaming | Extend the existing S3 client with private arbitrary-object operations; do not use the image-only processing pipeline |
| Jobs | Notifications has a bounded API timer; CRM has domain-specific PostgreSQL outboxes; worker is an empty Nest context | Start with a bounded API-hosted sweep and PostgreSQL row locks; move scanning to the worker scaffold before horizontal API scaling |
| Audit | platform_audit_events records actor-attributed Platform operations | Reuse it for Platform ticket-management actions; do not add event sourcing |
| UI | Separate permission-aware Admin and Platform shells, session hooks, same-origin proxy, Persian RTL pages | Add routes to these shells and reuse their session/API patterns |
| Subscription | Registered plan features gate selected tenant modules | Do not register a Ticketing feature or call a plan-feature check |

The repo has no reusable read/unread marker. Its CRM outboxes are bounded domain integrations, not a general event bus. Ticket SMS belongs in the existing notification outbox.

## Domain model

Ticket stores current queue/lifecycle state. TicketMessage stores the conversation as separate append-only/semi-immutable replies.

### Ticket

| Field | Purpose |
| --- | --- |
| id | Internal UUID for API routes; never an authorization credential |
| reference_number | PostgreSQL sequence value rendered as UC- plus decimal digits |
| coffee_shop_id | Required tenant owner with a restrictive foreign key |
| created_by_user_id | Administrative User who opened the ticket |
| subject | Trimmed plain text, 1–160 characters |
| department | Static enum initially containing TECHNICAL and SALES |
| status | WAITING_FOR_PLATFORM, WAITING_FOR_TENANT, or CLOSED |
| close_reason, closed_at, closed_by_user_id | Latest closure: MANUAL or INACTIVITY; actor is null for automatic close |
| last_message_at, last_message_sender_type | Conversation ordering and group unread calculation; changed only by a human reply |
| last_platform_reply_at | Authoritative inactivity-close clock; changed only by Platform Support replies |
| tenant_last_read_at, platform_last_read_at | Shared last-read cursors for each side; add with unread support, not required in Phase 1 |
| created_at, updated_at | Record timestamps; updated_at is not an auto-close input |

Use PostgreSQL enums for the small fixed status and department sets. Adding a department later is an additive code/catalog migration, not a data-model redesign. Do not create dynamic department administration.

### TicketMessage

Each submitted body is a new row with id, coffee_shop_id, ticket_id, sender_user_id, sender_type, body, and created_at. The sender_type enum records TENANT_USER or PLATFORM_USER at send time; do not infer it from current roles. sender_user_id references users and is required for human messages. The same User table covers both actor types.

Duplicate coffee_shop_id on TicketMessage permits tenant-scoped reads and a composite foreign key to Ticket (coffee_shop_id, id), preventing a message from being attached under a different tenant. Ticket creation and its first message commit together. Message edits/deletes are not normal conversation operations. A later system notice must have an explicit system kind and must never impersonate a user.

### TicketAttachment

When attachment upload is scheduled, metadata belongs to TicketMessage: id, coffee_shop_id, ticket_message_id, storage_key, original_filename, detected_mime_type, size_bytes, and created_at. Use a composite foreign key to TicketMessage (coffee_shop_id, id); the Ticket relationship is inherited through the message. Generate keys below tenants/{coffeeShopId}/support-tickets/{ticketId}/{messageId}/{uuid}. Never accept the key from or return it to a client. Retain attachment metadata and objects with their message.

Start with at most five files per message, up to 8 MiB each, from a short allowlist of raster image types and PDF. Check file signatures and size, sanitize filename metadata, and reject SVG, archives, and executables. Revisit limits when product needs and operational capacity are known.

## Ticket lifecycle

| Event | Result |
| --- | --- |
| Tenant creates a ticket with its first message | WAITING_FOR_PLATFORM |
| Platform user replies | WAITING_FOR_TENANT; update last_platform_reply_at |
| Tenant user replies | WAITING_FOR_PLATFORM |
| Platform explicitly closes | CLOSED with MANUAL and the acting user |
| Inactivity sweep closes an unanswered Platform reply | CLOSED with INACTIVITY and no human actor |
| Tenant replies to an INACTIVITY-closed ticket | Reopen to WAITING_FOR_PLATFORM and append the message |
| Tenant replies to a MANUAL-closed ticket | Conflict; a Platform user must reopen it |
| Platform explicitly reopens a closed ticket | WAITING_FOR_PLATFORM |

There is no OPEN state: it would duplicate WAITING_FOR_PLATFORM. A reply and its status transition are one transaction. Reopening never removes earlier messages. Keep latest closure metadata after reopen; status remains the current-state authority.

### 48-hour auto-close and concurrency

Close only when status is WAITING_FOR_TENANT and last_platform_reply_at is at least 48 hours old. Every new Platform reply advances that timestamp. Department, assignment, reads, and other metadata edits must not reset it. Never use Ticket.updated_at as the clock.

The future sweep selects bounded candidates, locks each Ticket row with FOR UPDATE SKIP LOCKED, then rechecks status, last_platform_reply_at, and the latest message side before closing. Tenant reply takes the same row lock before inserting its message or changing state. If the reply wins, the worker sees WAITING_FOR_PLATFORM and skips it. If the worker wins, the reply sees an INACTIVITY close and reopens in its transaction. Row locks and rechecks keep this safe across API instances; a single-worker assumption is not a correctness boundary. The current API timer pattern is adequate for the first bounded deployment, but duplicates scans across replicas; move the sweep to the existing worker scaffold before horizontal API scaling.

## Tenant isolation and permissions

Tenant endpoints use AccessTokenGuard, TenantContextGuard, and TenantPermissionGuard. Add one tenant permission, support.tickets.use, for list, detail, create, reply, and read state. Grant it to the existing owner role; other tenant roles receive it through current role management. It grants access to the café's shared ticket queue, not only tickets created by that user. Cafe Clients cannot use these routes.

Every tenant list/detail/message/attachment query includes resolved coffeeShopId and resource ID. Never accept tenant ID from a DTO or authorize by Ticket UUID/reference alone. Return tenant-neutral 404 for a foreign ticket. Persist the authenticated User as creator/sender. Enforce creator membership with a composite Ticket foreign key to coffee_shop_memberships (coffee_shop_id, user_id); an insert trigger checks the same-tenant active membership for TENANT_USER messages. TenantPermissionGuard still enforces active membership and the specific permission. Platform actors remain protected by current Platform RBAC.

Use PlatformPermissionGuard and the existing global role catalog:

| Permission | Meaning |
| --- | --- |
| support.tickets.view | List tickets and inspect threads |
| support.tickets.reply | Add a Platform reply; reply operations also require view |
| support.tickets.manage | Close, reopen, change department, and future assignment/priority; management also requires view |

The guard requires every listed permission; there is no implicit inheritance. Grant view/reply to existing support_operator. Keep manage limited to explicitly authorized supervisors/administrators through the role editor; platform_owner may receive all three through the additive permission migration. Do not add another RBAC system or role-name bypass.

## Attachments and private storage

MediaStorageService currently supports fixed image variants only and has no signed-URL workflow. Reuse its S3 client, private bucket, configuration, and tenant key discipline; add the smallest generic object put/get/delete operations needed. Do not run arbitrary files through Sharp or publish them through public media routes.

Verify Ticket/message authorization before upload. For download, resolve the attachment by ID joined to TicketMessage and Ticket, verify tenant scope or Platform permission, then stream the private object through the API. Knowing an attachment UUID or key is never sufficient. Hide storage_key and provider metadata from response DTOs. Compensate object writes if metadata persistence fails, following MediaService cleanup.

## SMS integration and failure behavior

Add notification types for ticket creation and replies. Enqueue after the Ticket/message change in the same transaction through encrypted notification_deliveries. The current API dispatcher, sms.ir adapter, numeric template configuration, stable deduplication keys, and bounded retries remain the only delivery path. Remote failure occurs after commit and cannot undo a conversation. Current enqueue behavior is fail-open if outbox insertion fails; log only safe event metadata.

Resolve Platform recipients from active users with a phone and support.tickets.reply permission, deduplicated per user. Notify the ticket creator on a Platform reply only while that user has an active account, membership, and support.tickets.use access in the Ticket's tenant; use the current admin contact and do not copy phones into Ticket or Message. If no eligible active recipient exists, persist the conversation and skip SMS. Deduplicate by notification type, message, and recipient. Keep SMS payloads generic and include the human reference only; never send message bodies, attachment keys, or unnecessary personal data.

## Read/unread

No existing UCafe feature stores read receipts. Use one shared cursor per side on Ticket: tenant_last_read_at and platform_last_read_at. A reply advances its sender side's cursor; viewing a thread advances that side's cursor. This matches the shared café inbox and support queue. An unread reply is an opposing-side last message newer than that side's cursor; waiting status separately indicates who acts next. Add per-user receipts only if support teams need independent inbox state.

## Human-readable reference

Generate reference_number from a PostgreSQL sequence and enforce uniqueness. Allocation is concurrency-safe; gaps after rollbacks are harmless. Render UC-10482 for SMS, search, and UI. Keep UUID as the internal identifier. Reference lookup still applies tenant and permission checks and never authorizes access.

## Audit, assignment, and priority

Platform close/reopen/department changes and future management actions use platform_audit_events with target_type support_ticket and a Ticket identifier. Write the audit row through the same transaction as the Ticket change. Summaries contain safe state changes only, never subject/body/phone or attachment metadata. Creation and replies are represented by Ticket and TicketMessage.

Do not add a generic event bus or TicketEvent table in Phase 1. The latest close reason/time/actor lives on Ticket; Platform-initiated changes are in the existing audit trail. This does not preserve every repeated automatic close/reopen event. If the product needs a tenant-visible immutable lifecycle timeline, add a small TicketEvent table then rather than mutating messages or widening global audit.

Do not add priority or assignment columns initially. Department and status are enough for the first queue. When measured workload justifies assignment, add nullable assigned_platform_user_id referencing users and an index then; priority can be added as a small enum without changing the conversation model.

## Retention and deletion

UCafe suspends/archives tenants and blocks users; tenant and user records are retained, and historical business/financial/audit records are preserved. Keep tickets available to Platform Support when a tenant is suspended or archived. Tenant access still follows authentication, membership, and host-resolution rules: suspended tenants resolve, while archived tenant hosts may not. Ticket endpoints do not call plan gates.

Use restrictive foreign keys from Ticket to coffee_shops and actor users, and from messages/attachments to their parents. Never cascade-delete conversations when a tenant, membership, or user is deactivated. Deleted/blocked actors remain identifiable as former café staff or Platform Support without exposing contact details. There is no permanent tenant/user hard-delete API today; a future hard-delete must define retention/anonymization first and explicitly handle messages and S3 objects.

## Expected indexes

- Unique reference_number.
- Tenant list: (coffee_shop_id, status, last_message_at DESC).
- Platform queue: (status, department, last_message_at DESC).
- Auto-close candidates: partial index on last_platform_reply_at for WAITING_FOR_TENANT.
- Message thread: (coffee_shop_id, ticket_id, created_at, id).
- Attachment lookup: ticket_message_id, plus unique storage_key.

Do not index assignment before it exists. Add subject search indexes only after choosing search behavior and reviewing representative query plans.

## API direction

Use existing REST conventions, DTO validation, UUID route pipes, bounded page/pageSize pagination, and explicit response projections.

| Surface | Direction |
| --- | --- |
| Tenant | POST/GET /api/v1/tenant/support/tickets; GET /:ticketId; POST /:ticketId/messages; a small read-state update route |
| Platform | GET /api/v1/platform/support/tickets; GET /:ticketId; POST /:ticketId/messages; PATCH /:ticketId for permitted management fields |

Tenant routes derive coffeeShopId from TenantContext. Platform routes use current Platform RBAC and may query across tenants. Never expose storage keys, actor phone numbers, or unnecessary user IDs. No Ticket route belongs under public/client API groups.

Tenant lists support status and pagination. Platform lists additionally support tenant, status, department, and exact reference filters. Full-text subject search remains deferred until the product chooses matching semantics and representative PostgreSQL plans justify an index.

## UI direction

Tenant routes belong at /admin/support, /admin/support/new, and /admin/support/[ticketId]. Add an AdminShell item shown only for support.tickets.use; do not make visibility depend on access.features. Reuse useAdminSession, the same-origin API proxy, and existing list/detail/form patterns.

Platform routes belong at /platform/support and /platform/support/[ticketId]. Reuse usePlatformSession, platform API helpers, and the permission-aware navigation pattern used by consultation requests and Platform CRM. Use a paginated queue, state/department badges, and existing Persian RTL loading, empty, error, and mobile patterns. No generic ticket inbox/thread component exists; keep initial UI pieces inside the support routes. UI hiding is convenience; API guards remain authoritative.

## Security and input contract

- Subject is trimmed plain text, 1–160 characters. Message body is trimmed plain text, 1–10,000 characters; do not render HTML.
- DTOs reject unknown fields. Tenant ID, sender side/ID, reference, state, and storage key are server-owned.
- Tenant checks use resolved context and scoped queries; Platform checks use explicit RBAC. UUIDs and references are identifiers, never secrets.
- Attachment streaming rechecks Ticket authorization on every request; a private URL or key is not authorization.
- Omit actor phones and storage metadata from client projections. Do not log message bodies, attachment names, full phones, provider payloads, or secrets.
- No subscription feature check applies. Valid identity, tenant membership, and explicit permissions still apply.

## Scenario review

| Scenario | Result |
| --- | --- |
| A. Tenant A creates a technical ticket | Host context supplies Tenant A's coffeeShopId; Ticket and initial message commit together in WAITING_FOR_PLATFORM |
| B. Tenant B obtains Tenant A's UUID/reference | Scoped query finds no row; reply and attachment stream use the same parent scope |
| C. Platform Support replies | Authorized Platform message and WAITING_FOR_TENANT update commit together; SMS is deferred to Phase 5 |
| D. Tenant replies | Active tenant membership is checked, message appends, and state becomes WAITING_FOR_PLATFORM; SMS is deferred to Phase 5 |
| E. Platform reply is unanswered for 48 hours | Sweep checks status and last_platform_reply_at, not updated_at |
| F. Reply races with auto-close | Shared Ticket row lock and recheck make one transition win; an inactivity-close winner is reopened by the tenant reply |
| G. Tenant replies after inactivity close | Same Ticket reopens to WAITING_FOR_PLATFORM and earlier messages remain |
| H. sms.ir is unavailable | Phase 1 is independent of sms.ir; the Phase 5 outbox integration will preserve committed Ticket and Message rows across provider failures |
| I. Tenant requests another tenant's attachment | Attachment ID is resolved through message and Ticket scope before private object streaming |

## Phase 1 implementation contract

Phase 1 implements the Core Ticket Backend:

1. Add Ticket and TicketMessage entities, TypeORM registrations, and a forward migration with the core fields, reference sequence, restrictive history relations, and justified indexes above. Add the per-side read cursors with the unread phase; add TicketAttachment when upload is scheduled.
2. Add tenant support.tickets.use and the three Platform permissions through the existing catalog/migration patterns. Seed owner/support_operator grants as described; preserve custom-role administration.
3. Implement tenant create/list/detail/reply and Platform list/detail/reply/manage APIs using existing guards, DTO validation, pagination, response projections, and tenant-neutral 404s.
4. Create the initial Tenant message with its Ticket atomically. Append replies and update side/status/timestamps in a locked transaction. Manual close/reopen is permission-guarded. Reopen automatically only after INACTIVITY closure; reject replies to MANUAL closures.
5. Do not enqueue or send Ticket SMS in Phase 1; integrate with NotificationsService and its existing outbox in Phase 5.
6. Add focused tests for tenant isolation, Platform permission combinations, create/reply state changes, manual versus inactivity close, reference uniqueness, and the reply/close lock race.
7. Exclude UI, attachment upload/download, auto-close scheduling, unread badge surfaces, assignment, priority, SLA, and advanced search. Attachment API/storage work follows this document when scheduled.

Before adding TypeORM entities, register each in both database.module.ts and data-source.ts. Keep Ticket independent of subscription features and Platform CRM. Update this document if implementation choices change.

## Phase 1 implementation

Migration `1790640000000-CreateSupportTickets` creates `support_tickets`, `support_ticket_messages`, PostgreSQL enums, the reference sequence, scoped foreign keys, the tenant-sender membership trigger, queue/thread indexes, and the four RBAC permissions. Messages and Ticket ownership retain restrictive user/tenant references. Tenant creator and sender identity comes from the authenticated principal; `coffeeShopId` comes from tenant context.

The API routes are `POST/GET /api/v1/tenant/support/tickets`, `GET /api/v1/tenant/support/tickets/:ticketId`, and `POST /api/v1/tenant/support/tickets/:ticketId/messages`; Platform routes are `GET /api/v1/platform/support/tickets`, `GET /:ticketId`, `POST /:ticketId/messages`, and `PATCH /:ticketId` with `{ "action": "CLOSE" | "REOPEN" }`. Lists use `page`/`pageSize`; tenant lists accept `status`, and Platform lists also accept `status`, `department`, `tenantId`, and exact `referenceNumber` filters.

Create, reply, close, and reopen operations lock the Ticket row and commit message/state changes together. Tenant UUID lookups include both Ticket ID and coffeeShopId and return 404 for foreign tickets. Manual close/reopen writes a PII-free `platform_audit_events` row in the same transaction. Tenant replies reopen only `INACTIVITY` closures; `MANUAL` closures require Platform reopen. Platform replies to closed tickets require reopen first. The `support_operator` role receives view/reply, `platform_owner` receives view/reply/manage, and the tenant `owner` role receives `support.tickets.use`; no Super Admin bypass was added.

Ticket references are `UC-<sequence>` values and are not used for authorization. Response projections omit user IDs, phone/email, password fields, and storage metadata. Detail responses expose each message's sender type, plain-text body, and timestamp. The Phase 1 API does not implement read cursors, attachment handling, notifications, the 48-hour worker, assignment, priority, or UI.

Phase 1 uses normal HTTP `POST` semantics and has no idempotency key: retried ticket or message submissions can create another row. Add request deduplication if client retry behavior produces duplicate conversations in practice.
