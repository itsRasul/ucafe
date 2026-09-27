# Platform CRM information architecture

This document records the implemented CRM placement and deferred roadmap UX. Organization, Contact, Lead, Deal, Activity, Task, Note, metadata, saved-view, Segment, Lead scoring, Workflow, and analytics workflows use nested App Router pages inside the existing platform application.

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

Implemented routes also include `/platform/crm/segments` and `/platform/crm/settings`. Organization, Contact, Lead, and Deal details show record custom fields and Tags alongside their Activity, Task, and Note sections. The organization detail page shows paginated/searchable Contacts and read-only linked Tenant information. Operators with both `crm.read` and `tenants.read` can link or unlink an available Tenant. All CRM pages use the same platform session, same-origin API, RTL CSS, and permission contract.

The Pipeline destination is `/platform/crm/pipeline`; the Tasks queue is `/platform/crm/tasks`; saved dynamic groups live at `/platform/crm/segments`; metadata administration lives at `/platform/crm/settings`; score rules live at `/platform/crm/settings/scoring`. Settings configures typed fields, Tags, and scoring rules; Pipeline stages remain code-defined. Avoid duplicating a flat list of every CRM object in the mobile bottom navigation.

Phase 10 adds `/platform/crm/analytics`, linked in the CRM desktop navigation and mobile bar. It presents Overview, Funnel, Pipeline, Sources, Activity/Tasks, Sales Owners, Scoring, Automation, and a `subscriptions.read`-gated Customer Lifecycle section. Date, owner, Lead source, and expected Deal Plan selections are reflected in URL query state; custom dates use native date inputs and validate before fetching. Independent reports have section-level error/retry states. The page uses responsive CSS tables/bars and existing platform CSS, not an added charting dependency. Filter dimensions intentionally differ by measure, and the page explains Deal-source and Task-date limits; see [ANALYTICS.md](ANALYTICS.md).

## Page structure

### Organizations

The implemented list supports name/city/website/Instagram search, city, Tenant-link and archive filters, allowlisted sorting, and 25-row pagination. Create/edit forms use associated labels and server validation. Exact duplicate candidates are shown before save and require an explicit continue action; records are never merged automatically. The detail page summarizes the business profile and Contacts, shows an authorized customer context for the linked Tenant, Trial, and Subscription, and contains separate Activity, Task, and Note sections with quick follow-up creation. Explicit link/unlink actions are separate from Organization profile editing and require CRM management plus Tenant read access. A direct Tenant operations link opens the existing Tenant record.

### Contacts

Contacts are shown within an Organization. Contact search supports name/role text and exact phone/email lookup; list rows omit phone and email. Individual edit forms fetch the protected single-Contact detail projection. Exact Contact duplicates are warned within the same Organization and do not block an explicit operator choice. The Contact detail route includes separate Activity, Task, and Note sections.

### Leads

The implemented queue filters by status, source, manual priority, assignee (including unassigned), archive state, text search, and score/activity criteria; it sorts by Overall, Fit, or Engagement score as well as existing fields. It shows Overall score alongside the still-independent Priority and supports 25-row paging. Create/edit forms include source, priority, assignment, snapshot fields, and optional Organization/Contact links. Exact duplicate candidates show record type, display label, matching fields, and status without exposing phone/email; an operator can link an existing record or explicitly continue with a separate Lead. Detail shows protected contact fields, source-request stage/services, qualification and unqualification context, linked Organization/Contact, timestamps, append-only status history, and a score panel with Fit/Engagement/Overall, band, contribution breakdown, configuration version, latest change history, and explicit recalculation. `/platform/crm/settings/scoring` reuses the Phase 7 field/operator builder for named positive or negative FIT/ENGAGEMENT rules, match preview, enable/disable, and archive. It is read-only for `crm.read`; mutation controls require `crm.manage`. Scores never change Priority or Lead lifecycle. Loading, empty, error, and success feedback use accessible status/alert regions; forms provide visible keyboard focus and mobile touch targets.

### Deals and Pipeline

`/platform/crm/deals` is the searchable, filterable, sortable, paginated Deal list. `/platform/crm/pipeline` is a six-column board for the fixed ordered stages, with open count and estimate totals per stage. Cards expose an accessible labeled stage selector; moving between columns is supported with native drag/drop and both paths call the same permission-protected transition API. Skips/backtracks request a reason and stale stage updates are rejected. Won/Lost are separate outcomes. Detail pages include dedicated Activity, Task, and Note sections, and allow creating a follow-up Task. Do not make hover or color the only status signal.

### Activities, Tasks, and Notes

The Tasks queue at `/platform/crm/tasks` provides Today, Overdue, Upcoming, All Open, and Completed views, text search, assignee and priority filters, pagination, and completion/cancellation/reopen actions. Due-date boundaries for Today use the browser's local day. Organization, Contact, Lead, and Deal details provide related work sections; Lead-only work remains visible after Lead conversion through the Organization projection. Follow-ups are regular Tasks with kind `FOLLOW_UP`. Activities record past interactions, Notes store plain-text context, and Task completion does not automatically create an Activity. Phase 5 adds a derived Organization Timeline; notification and automation remain out of scope.

### Organization 360

Organization detail composes a Persian-first 360 workspace above the existing Contact and work sections. It shows derived Contact/Lead/Deal/open-Deal/open-Task counts, last Activity, next Task, bounded recent Lead and Deal lists, open Task previews, recent Activity and Note previews, an authorized Tenant/Trial/Subscription panel, and the separately paginated Timeline. Current Tenant status and subscription dates come from owning-module read projections; customer-context loading errors remain separate from the CRM overview. Link/unlink refreshes the customer panel and Timeline. The Contact directory retains its existing search, pagination, archive, and edit flow; Contacts have no Organization-wide primary flag, so the 360 view does not invent one. Existing Activity/Task/Note forms remain the quick actions. Expected Plan on a Deal is labeled as expected and remains separate from the current Plan. Leads, Deals, Tasks, Contacts, and authorized Tenant records link to their existing pages.

Timeline filtering supports one CRM/customer category and inclusive local-day date bounds. Pages contain 20 items by default, with an API maximum of 100. Mixed event types render from stable machine types and metadata into Persian text, display masked operator labels or an explicit system/source label, and link back to the associated Lead, Deal, Contact, work section, or Tenant record when permitted. Customer context and Timeline require `subscriptions.read`; linking requires both `crm.manage` and `tenants.read`. Loading, empty, retryable error, and overview section-error states are kept local to the affected area. The section navigation and timeline controls remain keyboard labeled and responsive in RTL layouts.

### Custom fields, Tags, saved views, and Segments

`/platform/crm/settings` groups definition controls by supported record type and manages CRM-wide Tags. Field keys are fixed after creation; definitions expose deterministic display ordering. Record detail pages show existing metadata and expose an edit form only for mutable records and `crm.manage` users. Select options use stable IDs; archive feedback explains that history and existing assignments remain. Record Tag assignment has a searchable checkbox list, and controls use native input types, responsive wrapping, keyboard-visible focus, and 44px touch targets.

The Organization, Lead, and Deal directories provide a server-backed filter builder and saved-view selector above the existing list filters. Saved views restore the typed AST, ordinary search/status/archive filters, core sorting, and selected view ID in the URL. The Lead builder includes score and supported activity fields. The builder limits the operator to flat AND/OR rules, uses per-field operators and options, and shows removable condition chips. `/platform/crm/segments` lets an operator choose a record type, compose the same rules, request a live count plus a small sample, and save criteria. Lead Segments can use persisted score fields; score rules themselves cannot use score fields. Each Segment has a detail page with a human-readable criteria summary, current count, and paginated matching records. The UI does not load a full record set to filter in the browser.

## Existing design and implementation guidance

- Keep the Persian-first Vazir typography, RTL semantics, focus visibility, mobile layout, and reduced-motion behavior in platform.css.
- Reuse the same-origin `/api/backend` proxy, shared platform session/access hook, existing platform permission contract, and platform CSS; do not use tenant AdminSessionProvider.
- Prefer route-level pages under the existing Next.js App Router tree so CRM records have deep links and browser back/forward behavior. The UI Pro Max Next.js search matched App Router file routing and next/link for internal navigation; the repository's current /platform state switch does not provide record URLs.
- Reuse the current visual patterns for split list/detail, compact badges, feedback, and CSS tokens where they fit. Avoid turning local class selectors into a generic component library before a second concrete consumer exists.
- Keep responsive controls labeled and keyboard usable, use text/icon as well as color for state, and test mobile widths and reduced motion. There is no shared table or form primitive to assume.

The CRM uses Persian-first RTL copy, the existing Vazir typography and platform colors, visible focus, responsive row cards, and labeled controls. CRM adds one navigation destination; Leads and Organizations remain inside the CRM workspace. `crm.manage` controls mutation affordances; the API still enforces permissions on every operation.

## Phase 9 Workflow builder

`/platform/crm/workflows` lists enabled/disabled Workflows and exposes a structured Persian RTL editor to `crm.manage` users. It uses typed trigger controls, the existing Phase 7 filter builder, and a sequential action list with labeled move-up/down and remove buttons. It deliberately has no free-form canvas, branching, loops, templates, JavaScript, or arbitrary HTTP action. Read-only CRM users can view execution lists/details; failed action details show safe result/error metadata, and managers can request bounded retries. Workflow-created Tasks carry a visible “ساخته‌شده خودکار” badge. See [AUTOMATION.md](AUTOMATION.md).
