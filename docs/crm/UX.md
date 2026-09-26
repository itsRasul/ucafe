# Platform CRM information architecture

This document records the implemented Phase 1–4 placement and the deferred roadmap UX. Organization, Contact, Lead, Deal, Activity, Task, and Note workflows use nested App Router pages inside the existing platform application.

## Current platform surface

The current /platform route renders a single client-side PlatformAdmin view. Its local view state selects dashboard, Tenants, consultation requests, invoices, users, roles, permissions, plans, and audit. Navigation visibility follows the platform permission projection. The desktop shell uses a sidebar; mobile uses a horizontally scrollable bottom navigation. Views use local list/detail, forms, tables, badges, and empty/error/success states.

The platform surface reuses its existing brand, admin, and CSS patterns. Platform CSS defines local visual patterns for forms, tables, badges, toolbars, list/detail panes, messages, and empty states. These are CSS conventions, not reusable table/filter/form React components. Pagination, filters, and dialogs are implemented inside individual features; there is no shared CRM-ready drawer or dialog primitive. Current consultation request search is a local text filter. The global platform search is disabled and is not a product-wide search service.

`PlatformAdmin` and CRM use the shared `usePlatformSession` hook and same-origin API helper. The tenant AdminShell/AdminSessionProvider are not drop-in replacements because they use tenant identity and subscription context. CRM has a focused nested shell using the existing platform CSS; the existing `/platform` view behavior is preserved.

## Recommended placement

The `/platform` sidebar and mobile navigation expose one CRM destination to users with `crm.read`. CRM uses URL-backed App Router pages rather than adding each CRM view to the current PlatformAdmin view union.

CRM navigation:

- Organizations
- Leads
- Contacts remain reachable from Organization detail and have record-specific deep links rather than a separate top-level destination.

Implemented routes include `/platform/crm`, Organization and Lead list/detail/create pages, `/platform/crm/contacts/:contactId`, `/platform/crm/deals` and `/platform/crm/pipeline`, and `/platform/crm/tasks`. Organization, Contact, Lead, and Deal detail pages show separate Activity, Task, and Note sections. The organization detail page also shows paginated/searchable Contacts and read-only linked Tenant information. Operators with both `crm.read` and `tenants.read` can link or unlink an available Tenant. All CRM pages use the same platform session, same-origin API, RTL CSS, and permission contract.

The Pipeline destination is `/platform/crm/pipeline`; the Tasks queue is `/platform/crm/tasks`. Keep CRM Settings out because stages are code-defined. Avoid duplicating a flat list of every CRM object in the mobile bottom navigation.

## Page structure

### Organizations

The implemented list supports name/city/website/Instagram search, city, Tenant-link and archive filters, allowlisted sorting, and 25-row pagination. Create/edit forms use associated labels and server validation. Exact duplicate candidates are shown before save and require an explicit continue action; records are never merged automatically. The detail page summarizes the business profile and Contacts, shows linked Tenant context as read-only, and contains separate Activity, Task, and Note sections with quick follow-up creation. A direct Tenant operations link is deferred to Phase 6.

### Contacts

Contacts are shown within an Organization. Contact search supports name/role text and exact phone/email lookup; list rows omit phone and email. Individual edit forms fetch the protected single-Contact detail projection. Exact Contact duplicates are warned within the same Organization and do not block an explicit operator choice. The Contact detail route includes separate Activity, Task, and Note sections.

### Leads

The implemented queue filters by status, source, priority, assignee (including unassigned), archive state, and text search; it supports allowlisted sorting and 25-row paging. Create/edit forms include source, priority, assignment, snapshot fields, and optional Organization/Contact links. Exact duplicate candidates show record type, display label, matching fields, and status without exposing phone/email; an operator can link an existing record or explicitly continue with a separate Lead. Detail shows protected contact fields, source-request stage/services, qualification and unqualification context, linked Organization/Contact, timestamps, and append-only status history. Separate actions change ordinary status, qualify, unqualify with a reason, convert, archive, and restore. Conversion requires a canonical Organization and Contact and does not create a Deal. Loading, empty, error, and success feedback use accessible status/alert regions; forms provide visible keyboard focus and mobile touch targets.

### Deals and Pipeline

`/platform/crm/deals` is the searchable, filterable, sortable, paginated Deal list. `/platform/crm/pipeline` is a six-column board for the fixed ordered stages, with open count and estimate totals per stage. Cards expose an accessible labeled stage selector; moving between columns is supported with native drag/drop and both paths call the same permission-protected transition API. Skips/backtracks request a reason and stale stage updates are rejected. Won/Lost are separate outcomes. Detail pages include dedicated Activity, Task, and Note sections, and allow creating a follow-up Task. Do not make hover or color the only status signal.

### Activities, Tasks, and Notes

The Tasks queue at `/platform/crm/tasks` provides Today, Overdue, Upcoming, All Open, and Completed views, text search, assignee and priority filters, pagination, and completion/cancellation/reopen actions. Due-date boundaries for Today use the browser's local day. Organization, Contact, Lead, and Deal details provide related work sections; Lead-only work remains visible after Lead conversion through the Organization projection. Follow-ups are regular Tasks with kind `FOLLOW_UP`. Activities record past interactions, Notes store plain-text context, and Task completion does not automatically create an Activity. No unified timeline, notification, or automation is included in Phase 4.

### Organization 360

The consolidated cross-domain Organization 360 view remains Phase 5. Keep Tenant and Subscription facts in a separate labeled, read-only section with links to existing platform tools. CRM's Activity/Task/Note records and Lead/Deal histories remain distinct from provider/payment history.

## Existing design and implementation guidance

- Keep the Persian-first Vazir typography, RTL semantics, focus visibility, mobile layout, and reduced-motion behavior in platform.css.
- Reuse the same-origin `/api/backend` proxy, shared platform session/access hook, existing platform permission contract, and platform CSS; do not use tenant AdminSessionProvider.
- Prefer route-level pages under the existing Next.js App Router tree so CRM records have deep links and browser back/forward behavior. The UI Pro Max Next.js search matched App Router file routing and next/link for internal navigation; the repository's current /platform state switch does not provide record URLs.
- Reuse the current visual patterns for split list/detail, compact badges, feedback, and CSS tokens where they fit. Avoid turning local class selectors into a generic component library before a second concrete consumer exists.
- Keep responsive controls labeled and keyboard usable, use text/icon as well as color for state, and test mobile widths and reduced motion. There is no shared table or form primitive to assume.

The CRM uses Persian-first RTL copy, the existing Vazir typography and platform colors, visible focus, responsive row cards, and labeled controls. CRM adds one navigation destination; Leads and Organizations remain inside the CRM workspace. `crm.manage` controls mutation affordances; the API still enforces permissions on every operation.
