# Support Ticketing architecture

**Status:** Phases 1–7 are implemented as of 2026-09-29. Ticket persistence, tenant/platform APIs and UIs, permissions, lifecycle transitions, private message attachments, asynchronous SMS notifications, inactivity auto-close, shared unread markers, and bounded orphan-object cleanup are in place. Product status remains in [PRD.md](PRD.md).

## Goals and non-goals

Ticketing will provide a durable support conversation between tenant administrators and authorized UCafe platform staff. It reuses the existing administrative User identity, tenant context, Platform RBAC, PostgreSQL, private S3-compatible storage, and SMS outbox.

Phase 0 recorded the design only. Phase 1 implements tenant and Platform ticket APIs, manual close/reopen, and transactional message persistence. Phase 2 adds the Tenant-facing admin UI; Phase 3 adds the Platform Support Center; Phase 4 adds private message attachments; Phase 5 queues conversation SMS through the existing NotificationsService; Phase 6 adds bounded inactivity auto-close. Ticketing is available across subscription plans and is not a plan feature.

## Existing infrastructure to reuse

| Concern | Existing UCafe pattern | Ticketing direction |
| --- | --- | --- |
| API | NestJS domain modules, DTOs, services, TypeORM entities, forward migrations | Add one support module under the existing REST route groups |
| Tenant identity | Host-derived TenantContext uses coffeeShopId; tenant guards require active membership and database permissions | Store coffeeShopId on Ticket; derive it from trusted context on tenant requests |
| Admin identity | users is shared by tenant staff and platform operators; cafe clients are separate | Use User IDs for creator and human senders; do not add a Ticket user model |
| RBAC | Database-backed scope-separated permissions and guards | Add support permissions to the existing catalog and role assignments |
| SMS | sms.ir provider; encrypted notification_deliveries outbox, deduplication, bounded retries | Enqueue typed events through NotificationsService; never send SMS in a Ticket transaction |
| Storage | Private MinIO/S3 bucket and MediaStorageService; generated tenant object keys; API streaming | Extend the existing S3 client with private arbitrary-object operations; do not use the image-only processing pipeline |
| Jobs | Notifications has a bounded API timer; CRM has domain-specific PostgreSQL outboxes; worker is an empty Nest context | Use bounded API-hosted lifecycle and object-cleanup sweeps; row locks protect lifecycle transitions, and a worker move is only needed for measured load or operational isolation |
| Audit | platform_audit_events records actor-attributed Platform operations | Reuse it for Platform ticket-management actions; do not add event sourcing |
| UI | Separate permission-aware Admin and Platform shells, session hooks, same-origin proxy, Persian RTL pages | Add routes to these shells and reuse their session/API patterns |
| Subscription | Registered plan features gate selected tenant modules | Do not register a Ticketing feature or call a plan-feature check |

Ticket unread state uses the shared side-level cursors chosen in D-092. CRM outboxes remain bounded domain integrations, not a general event bus. Ticket SMS belongs in the existing notification outbox.

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
| tenant_last_read_at, platform_last_read_at | Shared last-read cursors for each side; advanced by the side's replies and detail reads |
| created_at, updated_at | Record timestamps; updated_at is not an auto-close input |

Use PostgreSQL enums for the small fixed status and department sets. Adding a department later is an additive code/catalog migration, not a data-model redesign. Do not create dynamic department administration.

### TicketMessage

Each submitted body is a new row with id, coffee_shop_id, ticket_id, sender_user_id, sender_type, body, and created_at. The sender_type enum records TENANT_USER or PLATFORM_USER at send time; do not infer it from current roles. sender_user_id references users and is required for human messages. The same User table covers both actor types.

Duplicate coffee_shop_id on TicketMessage permits tenant-scoped reads and a composite foreign key to Ticket (coffee_shop_id, id), preventing a message from being attached under a different tenant. Ticket creation and its first message commit together. Message edits/deletes are not normal conversation operations. A later system notice must have an explicit system kind and must never impersonate a user.

### TicketAttachment

`support_ticket_attachments` stores id, coffee_shop_id, ticket_message_id, storage_key, original_filename, detected_mime_type, size_bytes, and created_at. A composite restrictive foreign key ties `(coffee_shop_id,ticket_message_id)` to `(coffee_shop_id,id)` on TicketMessage; the Ticket relationship is inherited through the message. A unique storage-key constraint and message lookup index support this relationship. Retain attachment metadata and objects with their message; there is no post-send deletion operation.

At most five files may be included in one message, up to 8 MiB each. The allowlist is JPEG, PNG, WebP, and PDF. The API detects types from file signatures; images are additionally inspected by Sharp with the existing 24-megapixel ceiling. It ignores browser MIME as an authority, sanitizes display filenames, and rejects SVG, archives, text/HTML, and executables. Tenant creation, Tenant replies, and authorized Platform replies use the same limits. The message body remains required by the Phase 0 contract.

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

The API-hosted scheduler runs every 10 minutes after startup and does not run an unbounded startup sweep. Each pass selects at most 100 tickets with `status=WAITING_FOR_TENANT`, an old `last_platform_reply_at`, and `last_message_sender_type=PLATFORM_USER`; the existing partial `IDX_support_tickets_inactivity` index supports the status/timestamp lookup. The 48-hour duration is UTC elapsed time, held in one domain constant. A ticket closes shortly after its threshold according to scheduler cadence.

Each candidate is processed independently. The lifecycle service locks the Ticket row, rechecks status, timestamp, and last-message side, then conditionally updates the still-eligible row to `CLOSED` / `INACTIVITY`, setting `closed_at` from PostgreSQL's clock and leaving `closed_by_user_id` null. Tenant replies take the same row lock before appending a message or changing status. If the reply wins, auto-close skips the ticket; if auto-close wins, a following Tenant reply reopens it through the normal reply transaction. These checks make duplicate scheduler scans safe across API instances without a leader lock. Per-ticket failures are logged and later candidates continue; failed rows are retried on a later sweep. A whole-sweep query failure is logged and retried at the next cadence.

The worker does not add a TicketMessage, audit event, or SMS for automatic closure. Manual closure remains `MANUAL`; automatic closure uses `INACTIVITY`. Existing Tenant reply behavior after `INACTIVITY` closure preserves the conversation and latest closure metadata, accepts attachments through the normal reply path, and emits the normal single Tenant-reply SMS fan-out. Replies to `MANUAL` closures remain a conflict. `last_platform_reply_at` and the latest-message-side field already existed and are maintained by transactional reply writes, so Phase 6 needs no schema migration or data backfill; tickets with a null Platform-reply timestamp are ineligible.

No new UI behavior was needed: Tenant detail already offers reply after inactivity closure and keeps manual closures read-only. The worker processes one bounded set of 100 candidates per 10-minute pass; additional candidates wait for the next pass. No SLA, escalation, immutable Ticket event log, or separate worker infrastructure was added.

## Tenant isolation and permissions

Tenant endpoints use AccessTokenGuard, TenantContextGuard, and TenantPermissionGuard. Add one tenant permission, support.tickets.use, for list, detail, create, reply, and read state. Grant it to the existing owner role; other tenant roles receive it through current role management. It grants access to the café's shared ticket queue, not only tickets created by that user. Cafe Clients cannot use these routes.

Every tenant list/detail/message/attachment query includes resolved coffeeShopId and resource ID. Never accept tenant ID from a DTO or authorize by Ticket UUID/reference alone. Return tenant-neutral 404 for a foreign ticket. Persist the authenticated User as creator/sender. Enforce creator membership with a composite Ticket foreign key to coffee_shop_memberships (coffee_shop_id, user_id); an insert trigger checks the same-tenant active membership for TENANT_USER messages. TenantPermissionGuard still enforces active membership and the specific permission. Platform actors remain protected by current Platform RBAC.

Use PlatformPermissionGuard and the existing global role catalog:

| Permission | Meaning |
| --- | --- |
| support.tickets.view | List tickets and inspect threads |
| support.tickets.reply | Add a Platform reply; reply operations also require view |
| support.tickets.manage | Close, reopen, change department, and future assignment/priority; management also requires view |

Controllers require the permissions listed for each operation. In the effective Platform access projection, `support.tickets.reply` and `support.tickets.manage` also grant `support.tickets.view`, so custom roles with either capability can reach the read-only route and ticket they act on. No other permission inheritance or role-name bypass applies. The `support_operator` role receives view/reply; manage stays limited to explicitly authorized supervisors/administrators through the role editor; `platform_owner` receives all three through the Phase 1 permission migration.

## Attachments and private storage

`MediaStorageService` owns the existing S3 client, private bucket, and configuration. It now exposes generic private object put/get/delete operations for Ticket files; attachments do not enter the image-variant pipeline and are not exposed by public media routes. Multipart requests are capped by Multer at five in-memory files of 8 MiB each. Object keys are generated below `tenants/{coffeeShopId}/support-tickets/{ticketId}/{messageId}/{uuid}`; user filenames never form keys.

The Next.js catch-all API Route Handler forwards multipart request bodies as streams, so the web tier does not buffer the combined upload in memory. No Nginx/Caddy ingress configuration is tracked in this repository; a production ingress must allow at least 40 MiB plus multipart overhead for a maximum-size message.

Tenant create/reply routes run Tenant context and `support.tickets.use` guards before the upload interceptor. Platform reply uses the existing `support.tickets.view` plus `support.tickets.reply` guards. For download, the service joins attachment → message → ticket and scopes the ticket ID and, for Tenant access, the resolved coffeeShopId before reading the private object. Platform downloads require ticket view permission. The API streams content from `GET .../:ticketId/attachments/:attachmentId/content` with `private, no-store`, `nosniff`, and attachment disposition headers. No signed-URL workflow exists or is added; knowing an attachment UUID or key is never sufficient. Response projections include safe metadata and an authenticated content path, never the storage key or bucket.

The selected approach is one multipart message request, avoiding temporary-upload tokens. The service validates every file before storage, uploads objects, then writes the message, attachment metadata, and Ticket transition in one PostgreSQL transaction. If an upload partially fails, every generated key is deleted; if database persistence fails, newly uploaded objects are deleted. Cleanup errors are logged with only the Ticket ID and a safe storage error category. PostgreSQL and S3 are not atomic: a delete outage during compensation or process termination between upload and commit can leave an unreferenced private object; the Phase 7 sweep handles stale objects after a 24-hour grace period.

The Next catch-all streams multipart requests, and the API limits each request to five files at 8 MiB each. Configure the production ingress for at least 40 MiB plus multipart overhead. The existing S3 credentials need list access for the exact ticket prefix and delete access there. The bucket remains private. Storage is checked at API startup and in readiness; if it becomes unavailable after startup, text-only tickets continue while attachment operations and readiness report the dependency failure.

## SMS integration and failure behavior

Ticket creation (`SUPPORT_TICKET_CREATED`), Tenant replies (`SUPPORT_TICKET_TENANT_REPLIED`), and Platform replies (`SUPPORT_TICKET_PLATFORM_REPLIED`) enqueue one event per intended recipient in the same transaction as the Ticket/message update. Delivery uses only the existing encrypted `notification_deliveries` outbox, API dispatcher, sms.ir adapter, numeric template configuration, and bounded retries. sms.ir runs after commit; provider failure cannot undo a conversation. Safe provider status codes (HTTP or sms.ir status) are persisted and logged without response bodies, phone numbers, or credentials. Outbox insertion follows NotificationsService's existing fail-open behavior.

Creation and Tenant-reply alerts go to active Platform users with a verified phone and `support.tickets.reply`, deduplicated per recipient. Platform replies go only to the original Ticket creator while the user is active, has a verified phone, and retains an active membership with `support.tickets.use` for that café. Missing or invalid phone recipients are skipped and logged without exposing a number. Payloads contain the UC reference and, for Platform Support alerts, the centralized Persian department label. They never include message bodies, attachment data, UUIDs, or phone numbers. One Ticket action produces one notification per recipient regardless of attachment count. Reads, downloads, metadata changes, department changes, manual close/reopen, and auto-close do not notify. Retries are bounded to three attempts; unique outbox keys deduplicate re-enqueued events, while an ambiguous provider timeout may still result in a duplicate SMS after retry. No notification settings UI is part of this phase.

## Read/unread

Ticket keeps one shared cursor per side: `tenant_last_read_at` and `platform_last_read_at`. A reply advances its sender side's cursor; opening a detail advances that side's cursor without changing Ticket `updated_at`. Lists expose `hasUnread` when the latest message came from the other side after the cursor. Cards show a compact new-reply marker; waiting status separately indicates who acts next. No aggregate unread count, polling, or per-user receipts are implemented. Add per-user receipts only if support teams need independent inbox state.

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
| Tenant | POST/GET /api/v1/tenant/support/tickets; GET /:ticketId; POST /:ticketId/messages; multipart `files` accepted on create/reply; scoped attachment content GET |
| Platform | GET /api/v1/platform/support/tickets; GET /:ticketId; POST /:ticketId/messages; multipart `files` accepted for authorized replies; scoped attachment content GET; PATCH /:ticketId for permitted management fields |

Tenant routes derive coffeeShopId from TenantContext. Platform routes use current Platform RBAC and may query across tenants. Never expose storage keys, actor phone numbers, or unnecessary user IDs. No Ticket route belongs under public/client API groups.

Tenant lists support status and pagination. Platform lists support status, department, tenant ID, café name/slug, exact reference, and bounded case-insensitive search across partial ticket reference, subject, and café name. Search values are parameterized and pagination/order remain server-side. The current contains search scans the matching queue; add a trigram index if measured support volume makes it slow.

## UI direction

Tenant routes are /admin/support, /admin/support/new, and /admin/support/[ticketId]. The AdminShell item is shown only for support.tickets.use and does not depend on access.features. The pages reuse useAdminSession, the same-origin API proxy, and existing list/detail/form patterns.

Platform routes belong at /platform/support and /platform/support/[ticketId]. Reuse usePlatformSession, platform API helpers, and the permission-aware navigation pattern used by consultation requests and Platform CRM. Use a paginated queue, state/department badges, and existing Persian RTL loading, empty, error, and mobile patterns. No generic ticket inbox/thread component exists; keep initial UI pieces inside the support routes. UI hiding is convenience; API guards remain authoritative.

Phase 3 adds the permission-filtered Platform navigation link, a queue defaulted to `WAITING_FOR_PLATFORM` with an explicit all-status option, server-side search/filtering/pagination, ticket detail and plain-text conversation, authorized replies, and manage-authorized close/reopen/department actions. Phase 4 adds file selection/removal before submission, server-side count/size/type validation, Persian error copy, message attachment cards, lazy-on-demand image preview, and secure authenticated downloads to both Tenant and Platform threads. Every action is a semantic API operation; lifecycle and audit changes remain in the backend transaction. Assignment and priority remain absent from the core model and are not exposed.

## Security and input contract

- Subject is trimmed plain text, 1–160 characters. Message body is trimmed plain text, 1–10,000 characters; do not render HTML.
- DTOs reject unknown fields. Tenant ID, sender side/ID, reference, state, and storage key are server-owned.
- Tenant checks use resolved context and scoped queries; Platform checks use explicit RBAC. UUIDs and references are identifiers, never secrets.
- Attachment streaming rechecks Ticket authorization on every request; a private URL or key is not authorization.
- Attachment body text remains required; uploads are optional. Replies retain the existing lifecycle transition regardless of attached files.
- Successful attachment metadata and objects remain with the message when a Ticket closes, reopens, or the Tenant is suspended/archived. Tenant/user deactivation does not delete support history.
- Omit actor phones and storage metadata from client projections. Do not log message bodies, attachment names, full phones, provider payloads, or secrets.
- No subscription feature check applies. Valid identity, tenant membership, and explicit permissions still apply.

## Scenario review

| Scenario | Result |
| --- | --- |
| A. Tenant A creates a technical ticket | Host context supplies Tenant A's coffeeShopId; Ticket and initial message commit together in WAITING_FOR_PLATFORM |
| B. Tenant B obtains Tenant A's UUID/reference | Scoped query finds no row; reply and attachment stream use the same parent scope |
| C. Platform Support replies | Authorized Platform message, WAITING_FOR_TENANT update, and one creator notification outbox row commit together |
| D. Tenant replies | Active tenant membership is checked, message appends, state becomes WAITING_FOR_PLATFORM, and support recipients get one outbox row each |
| E. Platform reply is unanswered for 48 hours | Sweep checks status and last_platform_reply_at, not updated_at |
| F. Reply races with auto-close | Shared Ticket row lock and recheck make one transition win; an inactivity-close winner is reopened by the tenant reply |
| G. Tenant replies after inactivity close | Same Ticket reopens to WAITING_FOR_PLATFORM and earlier messages remain |
| H. sms.ir is unavailable | Ticket and Message rows remain committed; the existing dispatcher records a failed attempt and applies bounded retry behavior |
| I. Tenant requests another tenant's attachment | Attachment ID is resolved through message and Ticket scope before private object streaming |
| J. A side reads a reply | Its shared cursor advances without changing activity order; the other side's unread state is independent |
| K. Upload compensation leaves an orphan object | The 10-minute sweep only deletes untracked objects older than 24 hours within the current tenant's Ticket prefix |

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

The API routes are `POST/GET /api/v1/tenant/support/tickets`, `GET /api/v1/tenant/support/tickets/:ticketId`, and `POST /api/v1/tenant/support/tickets/:ticketId/messages`; Platform routes are `GET /api/v1/platform/support/tickets`, `GET /:ticketId`, `POST /:ticketId/messages`, and `PATCH /:ticketId` for lifecycle or department operations. Lists use `page`/`pageSize`; tenant lists accept `status`, and Platform lists also accept `status`, `department`, `tenantId`, `tenantSearch`, `search`, and exact `referenceNumber`.

Create, reply, close, and reopen operations lock the Ticket row and commit message/state changes together. Tenant UUID lookups include both Ticket ID and coffeeShopId and return 404 for foreign tickets. Manual close/reopen writes a PII-free `platform_audit_events` row in the same transaction. Tenant replies reopen only `INACTIVITY` closures; `MANUAL` closures require Platform reopen. Platform replies to closed tickets require reopen first. The `support_operator` role receives view/reply, `platform_owner` receives view/reply/manage, and the tenant `owner` role receives `support.tickets.use`; no Super Admin bypass was added.

Ticket references are `UC-<sequence>` values and are not used for authorization. Response projections omit user IDs, phone/email, password fields, and storage metadata. Detail responses expose each message's sender type, plain-text body, and timestamp. Phase 1 did not implement read cursors, attachment handling, notifications, the 48-hour worker, assignment, priority, or UI; Tenant screens were added in Phase 2 below.

Phase 1 uses normal HTTP `POST` semantics and has no idempotency key: retried ticket or message submissions can create another row. Add request deduplication if client retry behavior produces duplicate conversations in practice.

## Phase 2 Tenant Support UI

Tenant Admin routes are `/admin/support`, `/admin/support/new`, and `/admin/support/[ticketId]`. The `پشتیبانی` navigation entry requires `support.tickets.use` and has no subscription feature gate. All calls go through the existing same-origin admin API wrapper; tenant identity is never sent by the UI.

The list uses server pagination (`page` and `pageSize=25`) and preserves the API's last-activity ordering. Each linked ticket card shows its UC reference, subject, department, Persian status, and last-activity time. The list has an empty state with a create action plus loading, retry, and pagination states. The detail page shows the subject/reference, department, creation time, status guidance, and chronologically ordered plain-text messages. Tenant messages are labeled `شما`; Platform messages are labeled `پشتیبانی یوکافه`. Timestamps use `fa-IR` formatting and the tenant timezone.

Department labels are `TECHNICAL` → `فنی` and `SALES` → `فروش`. Status labels are `WAITING_FOR_PLATFORM` → `در انتظار پاسخ پشتیبانی`, `WAITING_FOR_TENANT` → `در انتظار پاسخ شما`, and `CLOSED` → `بسته شده`. The create form trims subject/message and matches backend bounds (subject 1–160, message 1–10,000 characters). Replies trim and match the 1–10,000 message bound. Pending requests disable the submit action and use an in-flight guard; successful creation navigates to the new detail, while successful replies replace the detail with the API response and clear the input.

At Phase 2, reply availability followed the returned lifecycle state: `CLOSED` with `INACTIVITY` remains replyable and the backend reopens it; `MANUAL` (or another non-inactivity close) is read-only and links to creating a new ticket. Waiting states identify whose response is expected. The UI maps common permission, not-found, closed, and input errors to Persian messages and never renders raw API errors or message HTML. Real-time updates and unread navigation counts remain out of scope.

The focused frontend suite is `npm test --workspace=@ucafe/web`; it uses Node's built-in test runner and server rendering to check list, form, conversation, and closed-state markup alongside contract/validation helpers. DOM-driven interactions and authenticated live flow need a browser test harness and tenant-admin session.

## Phase 3 Platform Support Center

Platform Admin routes are `/platform/support` and `/platform/support/[ticketId]`. The Platform sidebar and mobile navigation show `پشتیبانی` only when the effective session has `support.tickets.view`; reply or manage grants view through the existing AuthorizationService projection. Platform APIs still enforce the existing view/reply/manage decorators, with no role-name exception.

The queue uses server-side `page`/`pageSize=25`, ordered by most recent ticket activity then ID. Its initial status is explicitly `WAITING_FOR_PLATFORM`; the status control includes all statuses. Filters include status, department, café name/slug, and bounded search over ticket reference, subject, or café name. The API retains tenant ID and exact-reference filters. Search text is trimmed and capped at 120 characters, escaped for literal SQL `LIKE` characters, and parameterized. The contains search has no trigram index yet.

The queue displays reference, café name/slug, subject, department, Persian status, creation time, and last activity. Detail shows café identity, ticket metadata, turn/status guidance, and chronological plain-text messages with separate café/Platform labels. Replies require `support.tickets.reply`, reject closed tickets per the domain lifecycle, and update the page from the reply API response. Submissions are guarded against duplicate clicks while pending.

Users with `support.tickets.manage` can close, reopen, and change a ticket between the existing Technical and Sales departments. Close/reopen retain the existing manual close reason and lifecycle rules. Department changes lock the ticket, change only its department/update timestamp, and write a safe before/after audit record in the same transaction; they do not reset `last_platform_reply_at`. All mutations refetch on lifecycle conflicts. The Platform UI adds no priority/assignment fields because they are absent from the core model. No schema migration was needed.

Focused frontend tests cover permission visibility, mappings, query preservation, and rendered loading/error/empty/list/conversation states. API tests cover DTO validation and permission metadata; the PostgreSQL integration suite covers search, filtering, pagination, department audit, lifecycle, and tenant isolation when `TICKETING_INTEGRATION_DATABASE_URL` is configured. The support workspace uses the existing platform session, API proxy, CSS, and RBAC; it adds no dependency. Browser-authenticated flow and responsive viewport interaction require running local services and a Platform user.

## Phase 7 production hardening

Migration `1790660000000-SupportTicketReadCursors` adds the shared tenant/platform read timestamps and backfills the sending side as already read. Detail GET advances only the authorized side's cursor; all protected ticket API responses are `private, no-store`. Lists include `hasUnread`, rendered as a small new-reply marker in each UI. Read updates do not affect `updated_at` or inactivity closure.

The existing 10-minute API scheduler now runs inactivity close and a bounded orphan sweep independently, so one failing sweep does not suppress the other. Cleanup inspects up to 100 objects from one tenant page per pass, checks PostgreSQL attachment metadata before deleting, waits 24 hours from S3 `LastModified`, and is limited to 25 empty tenants per pass. Its process-local cursor restarts from the first tenant after API restart; persist cursor state only if measured volume makes rescanning a concern. No tracked attachment object is removed.

Ticket storage logs contain only a safe AWS error name/status. sms.ir errors persist a bounded provider status code in the notification outbox and log delivery type/entity, attempt, status, and code without response text, phone, body, or secrets. The API size ceiling is 40 MiB total plus multipart overhead; production ingress must permit that. Browser form fields are disabled while submissions are pending, and Tenant reply conflicts refresh the detail to show the current lifecycle state.

The S3 bucket remains a startup and readiness dependency. If storage fails after startup, text-only ticket operations remain usable, but readiness and attachment requests fail until storage recovers. There is still no aggregate unread count, polling, distributed sweep cursor, or authenticated browser acceptance in the repository test suite.
