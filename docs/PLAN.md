# ucafe implementation plan

Each phase is intended for one reviewable session. Do not start a later phase until the current phase meets `AGENTS.md` Definition of Done.

## Phase 1 — Repository foundation — Completed

- **Objective/scope:** npm monorepo, strict TypeScript, web/API/worker scaffolds, environment validation, Docker services and health endpoints.
- **Backend/frontend/database:** Nest API/worker, Next app, PostgreSQL/Redis/MinIO Compose, no domain schema yet.
- **Dependencies:** Node 22+, Docker Desktop.
- **Deliverables/acceptance:** install, type-check/build, health routes, containers start.
- **Validate:** `npm run typecheck`, `npm run build`, `docker compose ps`.
- **Do not:** product modules or UI polish.

## Phase 2A — Multi-tenant data foundation — Completed

- **Objective/scope:** coffee shops, primary branches, domains, hostname resolution and platform subdomains.
- **Database:** migration `1787742000000-CreateTenantFoundation.ts`.
- **Deliverables/acceptance:** tenant is resolved solely from a valid active hostname; scoped entities/constraints exist.
- **Validate:** API tests, migration run/show, public context live check.
- **Do not:** auth, billing or content.

## Phase 2B — Identity and RBAC — Completed

- **Objective/scope:** users, tenant memberships, platform/tenant roles and explicit permissions.
- **Database:** `1787745600000-CreateIdentityAndRbac.ts`.
- **Deliverables/acceptance:** separate platform/tenant authorization with no fallback; seeded roles/permissions.
- **Validate:** authorization guard tests and scoped API checks.
- **Do not:** custom role editor.

## Phase 3 — Tenant provisioning — Completed

- **Objective/scope:** platform-admin provisioning transaction, primary branch/domain/default settings and owner membership/invitation.
- **Backend:** platform bootstrap and tenant provisioning CLI/API.
- **Acceptance:** duplicate slug/host rejected; provisioned tenant can resolve; owner relation is tenant-scoped.
- **Validate:** provision a test tenant and query public context.
- **Do not:** self-service signup wizard.

## Phase 4A — Authentication foundation — Completed

- **Objective/scope:** Iranian phone normalization, OTP challenge security, access/refresh sessions and encrypted PII.
- **Database:** `1787749200000-CreateAuthenticationFoundation.ts`.
- **Acceptance:** OTP expiry/attempt/rate limits, refresh rotation/reuse handling, masked phone logs.
- **Validate:** auth unit tests and live request/verify/refresh.
- **Do not:** passwords or social login.

## Phase 4B — SMS provider abstraction — Completed for development

- **Objective/scope:** provider interface and development Kavenegar mock that logs OTP.
- **Acceptance:** mock is usable locally and refuses production execution.
- **Validate:** live Docker OTP request and masked development log.
- **Do not:** real Kavenegar calls/key storage until credentials are supplied.

## Phase 4C — Subscription lifecycle and enforcement — Completed

- **Objective/scope:** configurable plans/prices, explicit trial, prepaid calendar month, grace, suspension/reactivation and public enforcement.
- **Database:** `1787752800000-CreateSubscriptionFoundation.ts`.
- **Acceptance:** Silver active/Golden inactive defaults; price snapshots; seven-day rules; Persian suspended page.
- **Validate:** lifecycle tests and live trial/payment/reconcile/public checks.
- **Do not:** setup fees, postpaid billing, automated gateway billing.

## Phase 5 — Public tenant shell and suspension UX — Completed

- **Objective/scope:** tenant-aware SSR website shell, platform page and controlled unavailable state.
- **Frontend:** Persian RTL responsive foundation.
- **Acceptance:** unknown tenant 404; suspended site shows branded Persian state without technical details.
- **Validate:** web build and browser/curl checks.
- **Do not:** multiple templates or page builder.

## Phase 6A — Site content and branding — Completed

- **Objective/scope:** website text, controlled theme, contact/primary-branch information and weekly hours.
- **Database:** `1787756400000-CreateWebsiteContentFoundation.ts`.
- **Acceptance:** safe theme foregrounds, validated hours, SSR public rendering and admin/platform APIs.
- **Validate:** theme tests, API tests/build and live tenant page.
- **Do not:** media uploads, arbitrary CSS, multi-branch UX.

## Phase 6B — Menu foundation — Completed

- **Objective/scope:** categories, items, variants, prices, availability, featured state and public menu.
- **Database:** `1787760000000-CreateMenuFoundation.ts`, corrective `1787760600000-FixMenuTenantScopeTriggers.ts`.
- **Acceptance:** tenant-safe CRUD, valid pricing/variants, public active menu and unavailable state.
- **Validate:** menu tests, migration, API/web build and live rendering.
- **Do not:** ordering, add-ons, allergens/search.

## Phase 7A — Reservation backend foundation — Completed

- **Objective/scope:** reservation settings, future availability, OTP-authenticated creation, customer history, owner list/status and race-safe capacity.
- **Database:** `1787763600000-CreateReservationFoundation.ts`.
- **Acceptance:** valid opening-hour slots, party/lead/advance/capacity rules, advisory lock/recheck, no phone in responses, valid status transitions.
- **Validate:** API type-check/build/tests, migration, live availability/authenticated create/mine. Last recorded suite: 29/29 passed.
- **Do not:** physical table maps or auto-acceptance.

## Phase 7B — Customer reservation UI — Completed

- **Objective/scope:** premium mobile-first Persian flow for date/party, slot, name/phone/note, OTP and success.
- **Backend:** only integration corrections necessary for same-origin calls; no new domain feature.
- **Frontend:** `/reserve`, homepage CTA, loading/empty/error/success states, reduced motion; same-origin proxy.
- **Database:** none.
- **Dependencies:** completed 7A and functioning Docker API/web.
- **Deliverables/acceptance:** full browser flow creates a pending reservation; mobile/desktop RTL presentation works; no sensitive data is exposed; API/web containers healthy.
- **Validate:** `npm run typecheck --workspace=@ucafe/api`, web type-check/build, API tests, `docker compose up -d --build api web`, interactive availability + OTP + creation, console/error check.
- **Completion note:** same-origin tenant-host forwarding and the complete availability → OTP → pending-reservation browser flow were verified against rebuilt Docker services on 2026-08-27.
- **Do not:** owner dashboard, SMS production integration or table maps.

## Phase 7C — Owner reservation management UI — Completed

- **Objective/scope:** owner queue/list, date/status filtering, detail, confirm/reject/cancel/complete/no-show and settings form.
- **Backend:** fill only confirmed API gaps; preserve RBAC and privacy.
- **Frontend:** mobile-usable Persian tenant admin reservation screens.
- **Database:** none unless a reviewed requirement demands it.
- **Dependencies:** 7B completed and owner auth/session UI approach confirmed.
- **Acceptance:** authorized owner manages reservations and settings; invalid transitions/errors are clear; phone remains protected.
- **Validate:** type-check/build/tests and live owner/customer round trip.
- **Completion note:** standalone OTP-authenticated Persian reservation management at `/admin/reservations`, tenant-RBAC queue/detail/status/settings operations, validated date/status filters and privacy-safe projections were verified against rebuilt Docker services on 2026-08-27.
- **Do not:** general admin dashboard or notifications.

## Phase 8A — Owner admin shell — Completed

- **Objective/scope:** authenticated tenant admin navigation and overview for site/menu/reservations/subscription.
- **Acceptance:** permission-aware routes, RTL responsive shell, loading/error/upgrade states.
- **Validate:** auth/RBAC integration and browser checks.
- **Completion note:** shared OTP/refresh session handling, tenant permission projection, permission-filtered RTL navigation, overview and read-only module states were built and verified against rebuilt Docker services on 2026-08-27; mobile/desktop browser checks passed without overflow or console errors.
- **Do not:** implement module features beyond existing APIs.

## Phase 8B — Site and menu owner editors — Completed

- **Objective/scope:** practical forms for existing site/theme/hours and menu CRUD.
- **Acceptance:** validation, optimistic-safe feedback, no arbitrary CSS, public updates render correctly.
- **Validate:** end-to-end edits and accessibility checks.
- **Completion note:** permission-aware Persian editors for curated site content/theme/contact/hours and full menu category/item/variant CRUD were implemented in the shared owner shell. Persistence, public rendering, cleanup, responsive layouts, labeled controls and unsaved-change behavior were verified against rebuilt Docker services on 2026-08-27.
- **Do not:** media/page builder/order features.

## Phase 9 — Platform admin MVP — Completed

- **Objective/scope:** protected tenant provisioning, lifecycle/subscription/payment recording and essential tenant assistance UI.
- **Acceptance:** platform-only permissions, audited/high-confidence operations and configurable prices.
- **Validate:** platform RBAC and lifecycle end-to-end.
- **Do not:** automated billing or advanced analytics.

## Phase 10 — Media foundation — Completed

- **Objective/scope:** secure tenant-scoped logo/hero/gallery upload using S3-compatible storage, validation, crops/focal points and optimized formats.
- **Acceptance:** low-quality/missing media cannot break layout; access and file limits enforced.
- **Validate:** upload/security/render/performance tests.
- **Completion note:** private tenant-prefixed S3/MinIO storage, byte/pixel/dimension validation, WebP/AVIF variants, focal-point metadata, capped logo/hero/gallery APIs, tenant/platform guard separation, owner controls and responsive public rendering were implemented and live-verified on 2026-08-28.
- **Do not:** video pipeline or unrestricted asset library.

## Phase 11 — Production SMS and notifications — Completed for simulated delivery; production activation pending credentials

- **Objective/scope:** real Kavenegar adapter, secrets/configuration, reservation confirmation SMS and resilient delivery jobs.
- **Dependencies:** credentials and approved message templates.
- **Acceptance:** idempotent delivery, redacted logs, failure/retry behavior.
- **Do not:** marketing campaigns.
- **Completion note:** Kavenegar Lookup adapters for OTP and reservation confirmation, strict provider configuration, encrypted idempotent outbox delivery and bounded retries were implemented on 2026-08-28. Docker delivery is verified with the development simulator; a real send remains blocked on API key and approved panel templates.

## Phase 12 — Iranian payment gateway — Completed in simulation

- **Objective/scope:** prepaid Silver checkout, verified callback/webhook, idempotent payment recording and immediate reactivation.
- **Dependencies:** Zarinpal selected; production merchant ID and legal/business activation remain pending.
- **Acceptance:** no double credit, server-side verification, toman price snapshot and failure recovery.
- **Do not:** postpaid usage or recurring card billing.
- **Completion note:** implemented on 2026-08-28 with a configuration-selected simulator and compiled Zarinpal v4 adapter. Checkout snapshots the Silver plan, callback verification is server-side, payment credit is idempotent and successful settlement immediately reactivates the tenant. Real-provider acceptance remains pending a merchant ID.

## Phase 13 — Quality, security and launch readiness — Locally completed; production blocked

- **Objective/scope:** E2E/accessibility/performance/security coverage, proxy/TLS, backups, observability, deployment and operator runbooks.
- **Acceptance:** formal budgets/checklists pass; restore and migration procedure tested; production secrets/providers configured; no development OTP provider.
- **Do not:** add new product modules during stabilization.
- **Completion note:** local hardening completed on 2026-08-28: authenticated internal tenant forwarding, production simulator rejection, security headers/request IDs, dependency readiness, smoke/performance/accessibility checks, zero-high production dependency audit, and a successfully restored disposable backup. Production acceptance cannot complete without real Kavenegar/Zarinpal credentials and a selected hosting/DNS/TLS/monitoring environment.

## Post-MVP candidates — Not Started

Golden modules, ordering/payments, multiple branches/templates, custom domains, analytics, dietary/allergen tools and reviews/social integrations require separate product decisions and phases.

## Phase 14 — Minimal platform control center and access management — Completed

- **Objective/scope:** redesign `/platform` as a compact Persian control center while adding user status, scoped role assignment, custom roles and a read-only permission catalog.
- **Backend/database:** reuse the existing platform/tenant RBAC tables and scope triggers; add five platform permissions through migration `1787788800000-ExpandPlatformAccessManagement.ts`.
- **Acceptance:** platform-only access, masked phones, session revocation on block, protected/last-owner safeguards, audited mutations and no direct user permission overrides.
- **Validate:** API/web type-check and builds, full tests, migrations, Docker live API checks and responsive browser checks.
- **Do not:** user creation/deletion, membership invitation, permission-definition CRUD, impersonation, settings or advanced analytics.

## Phase 15 — Platform user and role access corrections — Completed

- **Objective/scope:** allow platform owners to assign/unassign catalog permissions on every role, create a user with one selected platform or tenant role, and view complete phone numbers in the protected user workspace.
- **Backend/database:** reuse existing user, membership and RBAC tables; create the user and initial assignment atomically; no schema migration.
- **Acceptance:** system/custom role permission changes work without allowing protected-role rename/deletion or total role-management lockout; tenant-role creation requires a valid coffee shop; full phones appear only behind `users.read`; mutations remain audited.
- **Validate:** API/web type-check and builds, full API tests, migrations, rebuilt Docker live API checks and responsive browser checks.
- **Do not:** permission-definition CRUD, user deletion, multiple initial roles, direct user permission overrides or changes to public/reservation phone privacy.
