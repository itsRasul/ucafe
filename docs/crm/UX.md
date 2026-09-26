# Platform CRM information architecture

This document records Phase 1's implemented placement and the deferred roadmap UX. Phase 1 adds the Organization directory, form, detail page, and Contact management inside the existing platform application.

## Current platform surface

The current /platform route renders a single client-side PlatformAdmin view. Its local view state selects dashboard, Tenants, consultation requests, invoices, users, roles, permissions, plans, and audit. Navigation visibility follows the platform permission projection. The desktop shell uses a sidebar; mobile uses a horizontally scrollable bottom navigation. Views use local list/detail, forms, tables, badges, and empty/error/success states.

The platform surface reuses its existing brand, admin, and CSS patterns. Platform CSS defines local visual patterns for forms, tables, badges, toolbars, list/detail panes, messages, and empty states. These are CSS conventions, not reusable table/filter/form React components. Pagination, filters, and dialogs are implemented inside individual features; there is no shared CRM-ready drawer or dialog primitive. Current consultation request search is a local text filter. The global platform search is disabled and is not a product-wide search service.

`PlatformAdmin` and CRM use the shared `usePlatformSession` hook and same-origin API helper. The tenant AdminShell/AdminSessionProvider are not drop-in replacements because they use tenant identity and subscription context. CRM has a focused nested shell using the existing platform CSS; the existing `/platform` view behavior is preserved.

## Recommended placement

The `/platform` sidebar and mobile navigation expose one CRM destination to users with `crm.read`. CRM uses URL-backed App Router pages rather than adding each CRM view to the current PlatformAdmin view union.

Initial Phase 1 navigation:

- Organizations
- Contacts as an Organization detail tab/list, not a second top-level destination unless usage proves that a global Contacts queue is needed.

Implemented routes are `/platform/crm`, `/platform/crm/organizations/new`, and `/platform/crm/organizations/:organizationId`. The organization detail page shows the business profile, a paginated/searchable Contact list, inline Contact creation/editing, and archive/restore actions. It displays linked Tenant name/status read-only; operators with both `crm.read` and `tenants.read` can link or unlink an available Tenant from the concise Organization form.

Later, add Leads in Phase 2, Pipeline in Phase 3, Tasks in Phase 4, and reports in Phase 10. Keep CRM Settings out until stages, tags, or other configuration actually exist. Avoid duplicating a flat list of every CRM object in the mobile bottom navigation.

## Page structure

### Organizations

The implemented list supports name/city/website/Instagram search, city, Tenant-link and archive filters, allowlisted sorting, and 25-row pagination. Create/edit forms use associated labels and server validation. Exact duplicate candidates are shown before save and require an explicit continue action; records are never merged automatically. The detail page summarizes the business profile and Contacts and shows linked Tenant context as read-only. The CRM shell links back to the platform home; a direct Tenant operations link is deferred to Phase 6. No future Lead, Deal, Task, Activity, or timeline tabs are shown.

### Contacts

Contacts are shown within an Organization. Contact search supports name/role text and exact phone/email lookup; list rows omit phone and email. Individual edit forms fetch the protected single-Contact detail projection. Exact Contact duplicates are warned within the same Organization and do not block an explicit operator choice.

### Leads

When Phase 2 arrives, provide a work queue with status, source, assignee, next follow-up, and age; detail should preserve original intake data separately from CRM qualification and history. Let an operator select a duplicate Organization/Contact explicitly.

### Pipeline and Tasks

Pipeline is a Deal board/list by current CRM stage and outcome, with an accessible list alternative to drag/drop. Tasks should emphasize due/overdue work, assignee, and related Organization/Deal. Do not make hover or color the only status signal.

### Organization 360

Use an organization-level page as the stable destination. Keep Tenant and Subscription facts in a separate labeled, read-only section with links to existing platform tools. CRM's Activity/Task/Note history and stages remain distinct from provider/payment history.

## Existing design and implementation guidance

- Keep the Persian-first Vazir typography, RTL semantics, focus visibility, mobile layout, and reduced-motion behavior in platform.css.
- Reuse the same-origin `/api/backend` proxy, shared platform session/access hook, existing platform permission contract, and platform CSS; do not use tenant AdminSessionProvider.
- Prefer route-level pages under the existing Next.js App Router tree so CRM records have deep links and browser back/forward behavior. The UI Pro Max Next.js search matched App Router file routing and next/link for internal navigation; the repository's current /platform state switch does not provide record URLs.
- Reuse the current visual patterns for split list/detail, compact badges, feedback, and CSS tokens where they fit. Avoid turning local class selectors into a generic component library before a second concrete consumer exists.
- Keep responsive controls labeled and keyboard usable, use text/icon as well as color for state, and test mobile widths and reduced motion. There is no shared table or form primitive to assume.

The CRM uses Persian-first RTL copy, the existing Vazir typography and platform colors, visible focus, responsive row cards, and labeled controls. Its single navigation entry preserves space in the platform mobile navigation. `crm.manage` controls mutation affordances; the API still enforces permissions on every operation.
