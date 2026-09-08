# ucafe progress checkpoint

**Checkpoint date:** 2026-09-08 (Asia/Tehran)
**Repository path:** `E:\programming\nodeJs\ucafe`  
**Last fully completed product phase:** Phase 15 — Platform user and role access corrections
**Current phase:** none (**Local hardening complete; production launch blocked on external credentials/infrastructure**)
**Next phase:** satisfy the external launch gates below

## Current status

The complete MVP feature set and local launch-hardening scope are implemented. Production now fails closed if simulators are selected; real Kavenegar/Zarinpal acceptance plus hosting, DNS, TLS and monitoring configuration remain external launch blockers.

This repository currently has no Git commit history/tracked baseline: `git status --short` reports the repository files as untracked. Do not assume a clean diff or use destructive Git cleanup.

## Completed work

- Platform admin now has a dedicated invoices section under `/platform`. Platform operators with both subscription-management and user-read authority can list tenant-created renewal invoices and open a detail view with cafe identity, payment status, plan/amount, gateway authority/reference, primary branch data and cafe admin/member contact/role data. The implementation reuses existing `payment_intents` as invoices and adds no schema migration.
- Tenant owners can now renew Silver subscriptions through an admin invoice flow. The subscription page shows plan price, status, period end, grace deadline, days remaining and a warning near expiry; renewal creates a Zarinpal-backed payment intent and opens an invoice detail page before payment. A new `/admin/invoices` section lists recent renewal invoices, and `/admin/subscription/payment-result` shows the verified callback result with amount, plan and reference when available. The public callback now redirects back to the tenant admin result page after server-side verification, while failed/expired payments do not extend the subscription.
- Tenant subscription summaries now include safe billing metadata and computed renewal-warning fields. Tenant payment-intent read endpoints expose owner-scoped invoice list/detail data under existing subscription permissions, returning payment links only for pending unexpired intents. Public unavailable copy remains neutral and does not mention subscription payment.
- Platform admin under `/platform` was visually redesigned as a Persian RTL platform control center inspired by the supplied light SaaS reference image, with a pale sidebar, compact topbar, cyan active navigation, dense list/detail surfaces, restrained status badges, refreshed entry states and mobile bottom navigation while preserving the existing platform APIs, permission checks, OTP/session behavior and operations.
- Tenant owner/staff admin under `/admin` was visually redesigned as a compact Persian RTL SaaS console inspired closely by the supplied reference image, while preserving the existing owner-admin routes, permission filtering, OTP/session behavior, Jalali date boundaries, site/media/menu/reservation/subscription workflows and API contracts.
- Project-wide rebrand from the former English/Persian names to `ucafe` and `یو کافه`, with domain-style values moved to `u-cafe.ir`/`u-cafe.localhost`; package scopes, Docker Compose defaults, public/admin/platform UI copy, internal headers/cookies/storage keys, docs, scripts and matching asset filenames were updated.
- Public reservation and tenant-admin reservation screens now accept and display reservation dates in Jalali form while preserving the existing ISO `YYYY-MM-DD` API/database contract for availability, creation and filtering.
- Platform user creation with one selected platform or tenant role, atomic tenant-membership creation when needed, and audited mutations without phone values in audit metadata.
- Assign/unassign permission checkboxes for every custom/system role while protected role identity/deletion remains locked and at least one active operator must retain role-management access.
- Complete phone-number projection in the `users.read`-protected platform user list/detail only; public and reservation phone projections remain unchanged.
- Minimal `/platform` control center with dashboard, searchable cafés, preserved provisioning/subscription/plan/audit operations, user status management, scoped role assignments, tenant-specific/platform custom roles and a read-only permission catalog.
- Five new platform permissions, masked user projections, transactional assignments, active-session revocation on block, audit events and protected/last-owner safeguards.
- Dedicated hostname-aware ucafe platform landing page on the base domain, separate from tenant storefronts, with a Persian RTL dark-blue AIDA presentation, product UI demonstrations, services, benefits, collaboration process, live Silver pricing, FAQ, responsive navigation and reduced-motion-aware GSAP enhancement.
- Public platform order-request capture with validated business/service fields, normalized encrypted Iranian mobile storage, blind-hash duplicate throttling, honeypot handling and privacy-safe responses. Requests persist as `NEW` for a future platform-admin workflow; no payment or checkout is initiated.
- Separate hostname-resolved `/menu` storefront with shared tenant header/footer, SSR metadata, a sticky horizontally scrollable category navigator, Persian-normalized search, responsive image-led cards, availability/variant pricing and accessible item-detail dialogs backed by `/menu?item=<id>` deep links. The landing page now keeps only its featured preview and routes every menu entry to the dedicated page.
- Project-wide self-hosted Vazir typography using the user-supplied Light, Regular, Medium and Bold WOFF2 files across public, reservation, tenant-admin and platform surfaces; headline scales were reduced and normalized for desktop and mobile, and the web Docker image now includes public font/media assets.
- Reference-aligned public storefront redesign based on the local `coffee` project: full-bleed photographic hero, dark espresso/cream palette, glass details, café features, dynamic featured items/menu, masonry-style gallery, opening hours, contact and reservation emphasis while preserving tenant-controlled content and SSR behavior.
- npm workspace and Docker scaffolding for web/API/worker, PostgreSQL, Redis and MinIO.
- Tenant, primary branch, domain/hostname resolution and provisioning.
- User/membership/platform-and-tenant RBAC.
- Iranian phone OTP authentication, encrypted phone PII, access/refresh sessions and development SMS mock.
- Trial/prepaid calendar-month/grace/suspension lifecycle, configurable Silver/Golden plan data and manual payment recording.
- Persian tenant public shell and controlled suspended state.
- Website content/theme/contact/opening-hours APIs and SSR presentation.
- Menu category/item/variant CRUD and public menu presentation.
- One tenant-scoped optimized image per menu item, with owner upload/replace/focal-point/delete controls and public featured/full-menu rendering with a stable fallback.
- Reservation settings, availability, authenticated create/mine, tenant list/status/settings, capacity locking and safe response projection.
- Customer reservation UI structure and styling at `/reserve`; homepage CTA added.
- Same-origin reservation proxy verified with tenant-host forwarding.
- Complete mobile browser flow verified through the Persian success state with a disposable development identity.
- Standalone owner OTP login and tenant-RBAC reservation management at `/admin/reservations`.
- Owner reservation queue with date/status filters, privacy-safe detail, valid status actions and clear terminal/error states.
- Reservation settings form for enablement, intervals, duration, party bounds, capacity, lead time and advance window.
- Tenant API status filter and tenant-scoped reservation detail endpoint with validated query/UUID input.
- Shared owner OTP session across `/admin` routes with automatic rotating refresh-cookie recovery and secure logout.
- Tenant-scoped admin access projection for the active membership's granted permission keys.
- Responsive RTL owner navigation and overview for site, menu, reservations and subscription.
- Permission-filtered module routes with loading, error, denied-access and future-upgrade states.
- Curated website editor for hero/story/announcement, safe theme colors, approved fonts/radius, contact/location and all seven opening-hour rows.
- Menu editor for category create/edit/delete and item create/edit/delete, including base prices, variants, default variant, availability, featured state and ordering.
- Safe two-step menu deletion UX, server validation feedback, public preview links, loading/empty/error/success states and unsaved-change feedback.
- Same-origin proxy support for the existing PUT and DELETE tenant mutations.
- Separate `/platform` OTP session and platform-only access projection with no tenant-permission fallback.
- Platform tenant list/detail projections and protected provisioning with optional owner invitation.
- Configurable Silver/Golden name, price, status, trial and grace controls backed by plan records.
- Trial start, manual future-month payment, reconciliation and recent payment history in the tenant operations workspace.
- Explicit confirmation for provisioning, price and subscription lifecycle operations.
- Append-only operator audit events and permission-protected audit history for platform changes.
- Private tenant-prefixed S3/MinIO media storage with automatic bucket initialization and health-checked Compose dependency.
- Validated logo/hero/gallery uploads with 8 MB, 24-megapixel, decoded-format and role-specific minimum-dimension limits.
- Fixed small/large WebP and AVIF output variants; originals are discarded and never publicly served.
- Tenant-scoped media metadata with database-enforced single logo/hero slots, key scope, bounded focal points/order and eight-image gallery cap.
- Separate `site.manage` tenant-owner and `tenants.update` platform media APIs with no authorization fallback.
- Binary-safe same-origin proxying, availability-guarded public media streaming and immutable response caching.
- Persian owner media controls for upload, focal point, gallery order and deletion within the curated site editor.
- Responsive public logo/hero/gallery `<picture>` rendering with stable aspect ratios, lazy gallery loading and safe no-media fallbacks.
- Kavenegar Lookup adapter for OTP and three-token reservation confirmation, selected entirely by validated environment configuration.
- Encrypted tenant-scoped notification outbox created atomically with confirmation, unique reservation/type idempotency, stale-claim recovery and three-attempt exponential backoff.
- Development delivery simulator that logs only masked recipients and never runs in production.
- Tenant-owner-only Silver checkout with immutable plan/price snapshots and idempotency keys.
- Configuration-selected Zarinpal v4 request/verify adapter plus a development callback simulator.
- Authority-bound public callback, server-side rial verification, duplicate-credit protection and immediate tenant reactivation.
- Persian owner subscription action wired through the same-origin API proxy.
- Constant-time authenticated tenant-host forwarding between web and API; forged direct headers cannot resolve another tenant.
- Production configuration gates that forbid development SMS, simulated payments and HTTP payment callbacks.
- API/web security headers, opaque request IDs and structured metadata-only HTTP logs.
- PostgreSQL/Redis/object-storage readiness endpoint, smoke/performance budget script, operations runbook and formal launch checklist.
- PostgreSQL backup and disposable restore-verification scripts, successfully exercised against all 12 migrations.

## Incomplete/partial work

No real Kavenegar or Zarinpal provider acceptance or production deployment exists because credentials and the hosting environment are unavailable. Therefore the project is feature-complete for the agreed MVP and locally hardened, but it is not yet production-launched or fully Phase-13 accepted.

## Important files from the current phase

- `apps/api/src/media/` — media entity, DTOs, image validation/optimization, S3 storage, service, controllers and tests.
- `apps/api/src/database/migrations/1787770800000-CreateMediaFoundation.ts`.
- `apps/api/src/config/environment.schema.ts`, `apps/api/src/database/data-source.ts`, `database.module.ts` and `app.module.ts`.
- `apps/api/src/payments/` — checkout intents, DTOs, provider abstraction, simulator, Zarinpal adapter, controllers, service and contract tests.
- `apps/api/src/database/migrations/1787778000000-CreatePaymentCheckout.ts`.
- `apps/web/src/app/admin/subscription/page.tsx`.
- `apps/web/src/app/admin/subscription/invoice/[intentId]/page.tsx`, `apps/web/src/app/admin/subscription/payment-result/page.tsx` and `apps/web/src/app/admin/invoices/page.tsx`.
- `apps/api/src/observability/request-observability.middleware.ts`, `health.controller.ts` and `tenants/proxy-trust.util.ts`.
- `scripts/backup.ps1`, `scripts/verify-restore.ps1` and `scripts/smoke.ps1`.
- `docs/OPERATIONS.md` and `docs/LAUNCH_CHECKLIST.md`.
- `apps/web/src/app/admin/site/media-editor.tsx`, `site-editor.tsx` and `admin.css`.
- `apps/web/src/app/page.tsx`, `media.css` and `api/backend/[...path]/route.ts`.
- `apps/web/src/app/platform-landing.tsx`, `platform-landing.css`, `platform-order-form.tsx` and `platform-landing-motion.tsx`.
- `apps/api/src/platform-orders/` and `apps/api/src/database/migrations/1787785200000-CreatePlatformOrderRequests.ts`.
- `apps/api/src/identity/platform-access.controller.ts`, `platform-access.service.ts`, `dto/platform-access.dto.ts` and `platform-access.service.spec.ts`.
- `apps/web/src/app/platform/platform-admin.tsx` and `platform.css`.
- `compose.yaml`, `.env.example`, `apps/api/package.json` and `package-lock.json`.

- `apps/api/src/reservations/` — entities, DTO, controllers, service, time utilities/tests and module.
- `apps/api/src/database/migrations/1787763600000-CreateReservationFoundation.ts`.
- `apps/api/src/tenants/tenant-context.middleware.ts` and `tenant-context.ts` — verified proxy-host integration.
- `apps/web/src/app/reserve/page.tsx` and `reserve-flow.tsx`.
- `apps/web/src/app/admin/reservations/page.tsx` and `reservations-admin.tsx`.
- `apps/web/src/app/admin/layout.tsx`, `admin-session.tsx`, `admin-shell.tsx`, `admin.css` and overview/section pages.
- `apps/web/src/app/admin/site/site-editor.tsx` and `site/page.tsx`.
- `apps/web/src/app/admin/menu/menu-editor.tsx` and `menu/page.tsx`.
- `apps/web/src/app/platform/` — protected platform operations UI and responsive styling.
- `apps/api/src/audit/` — platform audit service, controller and module.
- `apps/api/src/tenants/platform-admin-access.controller.ts` and `platform-tenants.controller.ts`.
- `apps/api/src/subscriptions/platform-plans.controller.ts` and `platform-subscriptions.controller.ts`.
- `apps/api/src/database/migrations/1787767200000-CreatePlatformAuditTrail.ts`.
- `apps/api/src/tenants/tenant-admin-access.controller.ts` and `apps/api/src/subscriptions/tenant-subscription.controller.ts`.
- `apps/web/src/app/api/backend/[...path]/route.ts`.
- `apps/web/src/app/page.tsx` and `styles.css`.
- `apps/web/src/app/menu/page.tsx`, `menu/menu-explorer.tsx`, `tenant-public-data.ts`, `tenant-public.tsx`, `tenant-storefront.tsx`, `tenant-mobile-nav.tsx` and `tenant.css`.
- Documentation checkpoint files at repository root/`docs/`.

## Migrations

Source contains fifteen migrations:

1. `1787742000000-CreateTenantFoundation.ts`
2. `1787745600000-CreateIdentityAndRbac.ts`
3. `1787749200000-CreateAuthenticationFoundation.ts`
4. `1787752800000-CreateSubscriptionFoundation.ts`
5. `1787756400000-CreateWebsiteContentFoundation.ts`
6. `1787760000000-CreateMenuFoundation.ts`
7. `1787760600000-FixMenuTenantScopeTriggers.ts`
8. `1787763600000-CreateReservationFoundation.ts`
9. `1787767200000-CreatePlatformAuditTrail.ts`
10. `1787770800000-CreateMediaFoundation.ts`
11. `1787774400000-CreateNotificationOutbox.ts`
12. `1787778000000-CreatePaymentCheckout.ts`
13. `1787781600000-AddMenuItemMedia.ts`
14. `1787785200000-CreatePlatformOrderRequests.ts`
15. `1787788800000-ExpandPlatformAccessManagement.ts`

All fifteen migrations were applied and rechecked with `migration:show`; there are no pending migrations.

## Latest checks

- 2026-09-08: Fixed the local tenant routing regression caused by Docker Compose and local env still setting `PLATFORM_BASE_DOMAIN` to production `u-cafe.ir` while local tenant hosts use `u-cafe.localhost`. Compose and local `.env` now use `u-cafe.localhost`, the simulated local payment callback is back to `http://localhost:3001`, `.env.example` was aligned with the ucafe rebrand, and the web HSTS guard now requires an explicit non-localhost base domain. `npm run typecheck --workspace=@ucafe/web` passed; `docker compose up -d --build web` rebuilt API/web successfully; Docker PostgreSQL reported latest migration `1787788800000`; live checks returned HTTP 200 for `localhost:3000/`, `ucafe-example.u-cafe.localhost:3000/`, `/menu`, `/reserve` and `/admin`, with local responses no longer emitting `Strict-Transport-Security`.
- 2026-09-08: Platform admin invoice list/detail was added over the existing `payment_intents` invoice model. New platform payment endpoints require both `subscriptions.manage` and `users.read`, returning cafe/payment data for lists and cafe admin/member contact data only on detail. `/platform` gained a Persian invoices navigation item, searchable split list/detail, payment status badges, branch details and admin roster. No schema migration was required. `npm run typecheck --workspace=@ucafe/api`, `npm run typecheck --workspace=@ucafe/web`, full `npm test` passed (**54/54**), `npm run build --workspace=@ucafe/web` passed, the Impeccable detector returned no findings for the changed platform UI files, and Docker PostgreSQL reported all 15 migrations applied with latest timestamp `1787788800000`. Host-side `npm run build --workspace=@ucafe/api` still failed because the Windows install lacks the `nest` CLI binary.
- 2026-09-08: Tenant-admin reservation detail now shows the reserving guest's full name and OTP-verified mobile number. The public reservation flow still stores the entered full name as `contactName`, authenticates the entered phone by OTP, and creates the reservation against the verified user; protected tenant reservation list/detail/status responses now include `customerPhone` from that verified user while public reservation creation and customer `mine` responses continue to omit phone data. No schema migration was required. `npm run typecheck --workspace=@ucafe/api`, `npm run typecheck --workspace=@ucafe/web`, full `npm test` passed (**54/54**), and `npm run build --workspace=@ucafe/web` passed. Host-side `npm run build --workspace=@ucafe/api` still failed because the Windows install lacks the `nest` CLI binary. Docker PostgreSQL directly reported all 15 migrations applied, latest timestamp `1787788800000`; host-side `migration:show` could not connect to `localhost:5432` because the current Compose Postgres service is not published on the host port.
- 2026-09-08: Owner subscription renewal flow implemented around existing `payment_intents` as on-demand invoices. API changes added owner-scoped invoice list/detail reads, richer tenant subscription summary fields, payable links only for pending unexpired intents, and public callback redirects to the tenant admin result page after verification. Web changes added the redesigned subscription workspace, invoice list, invoice detail, payment result page and subscription-nav warning badge. Public suspended/unavailable copy was updated to neutral Persian wording. `npm run typecheck --workspace=@ucafe/api`, `npm run typecheck --workspace=@ucafe/web`, full `npm run typecheck`, API tests and full `npm test` passed (**54/54**). `npm run build --workspace=@ucafe/web` passed. Host-side `npm run build --workspace=@ucafe/api` failed because the Windows install lacks the `nest` CLI binary and `npm install` is blocked by the repo's Linux-only Sharp dependency; Docker `compose up -d --build api web` successfully built both API and web images and restarted services. Docker API/web health checks returned HTTP 200 at `/api/v1/health`, `/api/v1/health/ready`, `/health`, `/admin/subscription`, `/admin/invoices` and `/admin/subscription/payment-result?status=FAILED`. PostgreSQL directly reported all 15 migrations applied, latest timestamp `1787788800000`. Impeccable detector returned no findings on the changed admin targets. Browser route verification was limited to unauthenticated admin/login rendering because no owner OTP was provided in this session.
- 2026-09-06: New user-supplied ucafe logo applied across the web surfaces as a shared SVG-backed brand asset. Public platform landing header/footer, tenant storefront fallback header/footer, suspended tenant state, owner admin shell/authentication, platform admin shell/authentication and root favicon metadata now use `apps/web/public/brand/ucafe-logo.svg` for visible logo rendering with smaller surface-specific sizing; PNG icon fallbacks remain for browser favicon/apple-touch compatibility. No backend, API, schema or tenant media pipeline behavior changed. `npm run typecheck --workspace=@ucafe/web` and `npm run build --workspace=@ucafe/web` passed. The Impeccable detector reported only pre-existing unrelated findings: a storefront underline `transition: width` warning and a platform landing decorative grid-background advisory.
- 2026-09-06: Platform admin visual redesign completed for `/platform` only. The shell and shared platform styling were changed to a light reference-inspired SaaS control center with pale sidebar, compact topbar/search, cyan active states, dense list/detail rows, refreshed status badges, entry/login states and mobile bottom navigation. No backend, API, schema, permission, tenant-admin or public storefront changes were made. `npm run migration:show --workspace=@ucafe/api` confirmed all 15 migrations applied; `docker compose ps` showed PostgreSQL, Redis, MinIO, API and web services running; `npm run typecheck --workspace=@ucafe/web`, `npm run build --workspace=@ucafe/web` and the Impeccable detector on changed platform targets passed. Browser verification used a production Next server on `http://127.0.0.1:3003/platform`; the unauthenticated platform login state rendered in Persian RTL with one H1, no horizontal overflow and 44px controls. Authenticated ready-state visual QA was not performed against a real platform account in this session to avoid creating or changing platform credentials.
- 2026-09-06: Tenant owner/staff admin visual redesign completed for `/admin` only. The shell, overview dashboard and shared admin styling were changed to a light compact SaaS console with pale sidebar, top toolbar, cyan active states, dense panels/rows, unified controls, mobile bottom navigation and updated login/loading states. No backend, API, schema, permission, platform-admin or public storefront changes were made. `npm run typecheck --workspace=@ucafe/web`, `npm run build --workspace=@ucafe/web`, `npm run migration:show --workspace=@ucafe/api` and the Impeccable detector on changed admin targets passed. Docker Desktop was unavailable. Local browser verification used the Next dev server on `http://localhost:3002/admin`; the unauthenticated loading/admin state rendered without the previous oversized heading. Authenticated owner workflow browser verification was limited because the accepted local OTP challenge's running API log stream was not attached in this session.
- 2026-09-06: Public `/reserve` and tenant-admin `/admin/reservations` now use the installed `@majidh1/jalalidatepicker` visual Jalali datepicker through the shared `JalaliDateInput`, including native `jdp:change` synchronization back to ISO `YYYY-MM-DD` API values. The package script is served from `apps/web/public/vendor` for reliable standalone Docker loading, while CSS comes from the package import. `npm ls @majidh1/jalalidatepicker --workspace=@ucafe/web` confirmed version 1.0.0 is installed and no conflicting datepicker package was found. `migration:show --workspace=@ucafe/api` confirmed all 15 migrations applied. `npm run build --workspace=@ucafe/web`, `npm run typecheck --workspace=@ucafe/web` and full `npm run typecheck` passed when run serially; earlier parallel typecheck/build attempts failed with TS6053 because `next build` was regenerating `.next/types`. Rebuilt Docker API/web services are running, `/reserve` and `/admin/reservations` returned HTTP 200, and browser AX verification on `/reserve` showed the Jalali picker year/month grid and day controls. No schema migration was required.
- 2026-09-05: Jalali reservation date UI update completed. Public `/reserve` and tenant-admin `/admin/reservations` now accept/display Jalali dates while submitting ISO `YYYY-MM-DD` to the unchanged API. `npm run typecheck --workspace=@ucafe/web`, full `npm run typecheck`, `npm run build --workspace=@ucafe/web`, and full `npm test` passed (**51/51**). `docker compose ps` showed API, web, PostgreSQL, Redis and MinIO running; `migration:show` was started but produced no result before being interrupted, and no schema migration was required for this UI-only change.
- 2026-09-05: project-wide rebrand scan found no remaining former English/Persian brand strings. `npm run typecheck` passed across API, web and worker; `npm test` passed **51/51**; `npm run build` passed across API, web and worker. Before the rename, `docker compose ps` showed API, web, PostgreSQL, Redis and MinIO running, and `migration:show` showed all 15 source migrations applied. After the rename, `migration:show --workspace=@ucafe/api` reached PostgreSQL but failed authentication because the existing local data volume still has the pre-rename database role/password; recreate or migrate the local database volume before using the new Compose defaults live.
- 2026-09-04: Phase 15 API/web type-checks and production builds passed; the expanded API suite passed **51/51** and all 15 migrations remain applied. Rebuilt Docker API/web returned HTTP 200. Disposable live flows confirmed complete user phone projection, atomic creation with the selected `support_operator` role, tenant-role creation with a matching invited membership, and permission updates on a protected system role without renaming it; all disposable users, memberships, sessions and audit rows were removed. Browser QA confirmed the complete phone list, new-user role form and editable system-role permission checkboxes; the 390×844 layout had no horizontal overflow and the console had no warnings/errors.
- 2026-09-03: Phase 14 API/web type-checks and API/web production builds passed; the full API suite passed **47/47** and all 15 migrations are applied. Rebuilt Docker API/web returned HTTP 200 for health and `/platform`; authenticated live reads returned 11 owner permissions, 7 users, 5 roles and 19 permission definitions. Self-block and protected-role deletion both returned HTTP 409. Browser checks at 1440×900 and 390×844 confirmed RTL, one H1, no overflow and no console warnings/errors.
- 2026-09-03: the ucafe platform landing and order-request capture passed full repository type-check and production builds; the API suite passed **47/47**. Migration 17 applied successfully. Rebuilt API/web containers returned HTTP 200 for web health, API liveness/readiness, the public Silver offering and both platform and tenant SSR homes. A disposable form submission returned only id/status/time, stored encrypted phone data with a 64-character blind hash, and was removed after verification. Browser QA at 1440×900 and 390×844 confirmed a two-line H1, live 1,900,000 toman price, one H1, 44px mobile menu, working mobile navigation and FAQ, complete form labeling, no horizontal overflow and no console warnings/errors. A subsequent visual refinement reduced all platform heading scales to one or two lines at both QA widths, changed the secondary accent/hover pair to `#0466c8`/`#0353a4` with white button text, replaced synthetic hero UI with optimized desktop/mobile storefront captures, and added the four supplied service SVGs; all assets loaded in the rebuilt Docker web image.
- 2026-09-03: the dedicated public menu page passed the web type-check and production build; the full repository type-check passed and the full test suite remained **42/42**. The rebuilt Docker web service returned HTTP 200 for the tenant landing page, `/menu`, public menu/site projections and web health; API liveness/readiness returned HTTP 200 with PostgreSQL, Redis and object storage ready. Browser QA at 1440×900 and 390×844 verified landing/menu navigation, valid and invalid item deep links, Persian item/description/variant search, no-results reset, active smooth category scrolling, base and variant prices, unavailable items, native dialog close/Escape/Back behavior with focus restoration, 44px+ mobile controls, no horizontal overflow and no console warnings/errors. The standard API service could not bind host port 3001 because an unrelated local service owns it, so the same Compose API image was run network-only for live web integration without stopping that process.
- 2026-09-02: menu-item media passed API/web type-checks, API tests (**42/42**) and API/web production builds. Migration `1787781600000-AddMenuItemMedia.ts` is applied. Rebuilt API/web containers remained healthy; an optimized test image uploaded for a tenant-scoped item, streamed through the public proxy as WebP with HTTP 200, appeared on the matching storefront row, and was then removed. In-app browser verification found one image slot per seeded menu item, uploaded/fallback sources selected correctly, and no horizontal overflow. The upload control was then moved directly into both the create and edit item forms; a newly selected image uploads after item creation, with duplicate-safe recovery if the media step fails. The revised web type-check and production build passed.
- 2026-09-02: project-wide Vazir typography and reduced headline scales passed web type-check and production build. The rebuilt Docker web image served the supplied WOFF2 font with HTTP 200 and `font/woff2`; browser checks confirmed `Vazir` as the computed body/H1 font on public, reservation, admin and platform pages at 1440×900 and 390×844. Final headline measurements were 72px/39px for the public hero, 50.4px/31.2px for public section headings, 28.8px/20.8px for reservation H1, 40.8px/27.2px for admin H1 and 37.6px/26.4px for platform H1, with no horizontal overflow or console warnings/errors.
- 2026-09-01: the shared tenant landing page was redesigned to match the supplied local coffee-shop reference while preserving API-backed tenant branding, content, media, menu, opening hours, contact and reservation links. Web type-check and production build passed; the rebuilt web container served the redesigned tenant SSR page on port 3000 with HTTP 200. Browser QA at 390×844 and 1440×900 confirmed one H1, RTL semantics, working desktop/mobile navigation, 48px mobile menu control, no horizontal overflow, progressive reveal motion, reduced-motion fallback and no console warnings/errors.
- 2026-09-01: the full repository test command passed **42/42** and `migration:show` confirmed all 13 migrations currently present in the working tree are applied.
- 2026-08-29: the shared public tenant storefront was redesigned with the requested `gpt-taste` direction. Web type-check and production build passed; browser QA at 390×844 and 1440×900 confirmed one H1, a three-line maximum hero in the seeded tenant, no horizontal overflow, no visible sub-44px links, active GSAP story/menu motion, reduced-motion CSS and no console warnings/errors.
- 2026-08-29: the rebuilt web Docker image completed, but the Compose operation also attempted the API dependency and Docker Desktop disconnected while transferring the known oversized API build context; ports 3000/3001 then stopped responding. Visual integration was completed against a temporary read-only public API fixture on isolated ports and the fixture was removed afterward. A clean Docker Desktop restart and `docker compose up -d web` remain necessary to place the already-built web image on the example port.

- 2026-08-27: API and web type-checks passed.
- 2026-08-27: API tests passed, **29/29**.
- 2026-08-27: API and web production builds passed; rebuilt Docker API/web images started successfully.
- 2026-08-27: API/web health and same-origin availability proxy returned HTTP 200.
- 2026-08-27: the full mobile browser flow created pending reservation `3ed4824d-cf1e-4e4c-a8ed-9b3065e99e96` for a disposable development identity and reached the Persian success state.
- 2026-08-27: mobile and desktop RTL layouts showed no horizontal overflow; homepage CTA, validation error feedback and the reduced-motion rule were verified; browser console had no warnings/errors.
- 2026-08-27: Phase 7C API/web type-checks and production builds passed; API tests remained **29/29**.
- 2026-08-27: rebuilt Docker API/web services and both health routes returned HTTP 200; the owner admin route returned HTTP 200.
- 2026-08-27: live customer creation followed by owner pending filtering, tenant-scoped detail, confirmation, completion and settings save passed; an invalid repeat confirmation returned HTTP 409 and a non-owner tenant request returned HTTP 403.
- 2026-08-27: owner list/detail projections were rechecked with no phone field; completed status filtering returned the live round-trip reservation.
- 2026-08-27: `/admin/reservations` was browser-checked at 390px and 1440px: RTL, 48px controls, no horizontal overflow and no console warnings/errors.
- Reservation response projection was reviewed and contains no phone field.
- Lint was not run because no lint script exists.
- 2026-08-27: Phase 8A API/web/worker type-checks and production builds passed; API tests remained **29/29**.
- 2026-08-27: all eight migrations remained applied with none pending; Phase 8A required no schema migration.
- 2026-08-27: rebuilt Docker API/web services and both health endpoints returned HTTP 200; `/admin` returned HTTP 200 and unauthenticated tenant admin/subscription APIs returned HTTP 401.
- 2026-08-27: proxy OTP request reached the development SMS provider; the disposable validation membership/user was removed afterward.
- 2026-08-27: `/admin` login/loading state was browser-checked at 390×844 and 1440×900: Persian RTL, no horizontal overflow and no console warnings/errors.
- 2026-08-27: authenticated owner access remains backed by the previously verified Phase 7C OTP/RBAC flow; scripted entry of the new one-time code was blocked by the execution environment's secret-handling guard, so no fresh automated browser OTP submission was performed.
- 2026-08-27: Phase 8B API/web/worker type-checks and production builds passed; API tests remained **29/29**.
- 2026-08-27: all eight migrations remained applied and `migration:run` reported no pending migrations; Phase 8B required no schema migration.
- 2026-08-27: Docker PostgreSQL/Redis were healthy, API/web were running, and API health, web health, `/admin/site` and `/admin/menu` returned HTTP 200.
- 2026-08-27: live owner API round trip through the same-origin proxy updated site content, verified it in `/public/site`, created a temporary active category and two-variant featured item, verified them in `/public/menu`, then removed the temporary menu records and restored the original site content.
- 2026-08-27: authenticated `/admin/site` and `/admin/menu` browser checks passed at 390×844 and 1440×900 with no horizontal overflow or console warnings/errors; all editor fields were labeled, visible interactive targets met the existing 44px minimum, and unsaved edits enabled saving but were discarded on reload.
- 2026-08-28: Phase 9 API/web/worker type-checks and production builds passed; API tests remained **29/29**.
- 2026-08-28: migration 9 created the append-only platform audit trail; all nine migrations are applied with none pending.
- 2026-08-28: rebuilt Docker API/web images started against the preserved PostgreSQL/Redis volumes; both data services remained healthy and API/web health returned HTTP 200.
- 2026-08-28: same-origin platform OTP authentication returned all six platform-owner permissions; tenant list/detail, plans and subscription summary reads passed, a duplicate provisioning validation returned HTTP 409, and an unchanged Silver plan save round-trip preserved 1,900,000 toman while creating an audit event.
- 2026-08-28: a tenant-owner token received HTTP 403 from platform access while an unauthenticated request received HTTP 401, confirming strict platform/tenant RBAC separation.
- 2026-08-28: the in-app browser could not reach the host-local Docker port (`ERR_CONNECTION_REFUSED`), so authenticated visual browser verification was not repeated; production compilation and live same-origin API integration were verified instead.
- 2026-08-28: Phase 10 API/web/worker type-checks and production builds passed; API tests passed **31/31**, including decoded-format, minimum-size, byte-limit and real AVIF/WebP generation checks.
- 2026-08-28: migration 10 created tenant-scoped media metadata, partial single-slot uniqueness, gallery/key/focal/order safeguards; all ten migrations are applied with none pending.
- 2026-08-28: Docker API/web rebuilt successfully with explicit Windows and Alpine/musl Sharp runtimes; PostgreSQL, Redis and MinIO were healthy and API/web health returned HTTP 200.
- 2026-08-28: a live platform-authenticated same-origin multipart upload generated a public `image/avif` variant, appeared in `/public/site` and SSR `<picture>` markup, and deletion restored the safe fallback. A spoofed image returned HTTP 400 and the same platform token received HTTP 403 from the tenant media route.
- 2026-08-28: the disposable validation identity/role was removed; test media objects were deleted and no active test media remains.
- 2026-08-28: Phase 11 API/web/worker type-checks and production builds passed; the expanded API suite passed 32/32, including the mocked Kavenegar Lookup contract test.
- 2026-08-28: migration 11 created the encrypted idempotent notification outbox; all eleven migrations are applied with none pending.
- 2026-08-28: rebuilt Docker API started successfully; a simulated encrypted confirmation job reached `SENT`, logged only a masked recipient, received a mock provider ID and was removed after verification.
- 2026-08-28: Phase 12 API/web/worker type-checks and production builds passed; the expanded API suite passed **34/34**, including simulated and mocked Zarinpal v4 contract tests.
- 2026-08-28: migration 12 created tenant-scoped payment intents and owner-only `subscription.checkout`; all twelve migrations are applied with none pending.
- 2026-08-28: rebuilt Docker API/web services started successfully; PostgreSQL, Redis and MinIO were healthy and API/web health returned HTTP 200.
- 2026-08-28: a live simulated callback recorded exactly one 1,900,000 toman prepaid payment, returned the same paid result on a duplicate callback and immediately extended the subscription; all disposable payment data was removed and the pre-check subscription state restored.
- 2026-08-28: Phase 13 type-checks and production builds passed; the expanded API suite passed **37/37**, including production fail-closed and internal proxy authentication tests. `npm audit --omit=dev` reported zero vulnerabilities.
- 2026-08-28: Docker services rebuilt and readiness confirmed PostgreSQL, Redis and MinIO; all 12 migrations remain applied. A forged internal tenant header returned 404 while the authenticated web proxy returned 200.
- 2026-08-28: smoke/security/HTML-budget checks passed; five warmed tenant SSR requests averaged 52.7 ms with an 86.9 ms maximum locally.
- 2026-08-28: in-app browser checks at 390×844 and 1440×900 confirmed Persian RTL semantics, one main heading, labeled controls, alt coverage, reduced-motion CSS, no horizontal overflow and no console warnings/errors.
- 2026-08-28: a PostgreSQL custom dump restored into a disposable database with all 12 migrations verified; the disposable database and test dump were removed afterward without changing tenant data.

## Known errors and technical debt

- The web same-origin proxy’s tenant-host forwarding works locally, but production proxy trust must still be explicit and hardened.
- Docker still transfers the large root `node_modules` because the current offline-compatible images copy local dependencies; moving to registry-built multi-stage images is hosting/release pipeline work.
- `README.md` incorrectly says Phase 1 is in progress; this is intentionally recorded rather than edited outside the requested documentation set.
- `docs/MVP.md` and `docs/DEVELOPMENT.md` remain useful but are less complete than the new canonical documents.
- All repository content is untracked; establish a baseline commit only when the user asks.
- No lint tooling, durable automated browser E2E suite, centralized log/metric destination or hosting-specific container scanning.
- Synchronous image processing is intentionally bounded but should move to idempotent worker jobs if production load warrants it; orphan-object reconciliation is not automated.
- Reservation API errors are English while the public UI is Persian; user-facing error localization is incomplete.
- Reservation UI dates are Jalali at public/admin boundaries; the API and database still use ISO `YYYY-MM-DD`.
- Date/time logic supports same-day opening ranges only, not cafes operating past midnight.
- Access tokens remain tab-scoped in session storage, while the HttpOnly rotating refresh cookie now renews expired owner access through the same-origin proxy.

## Open questions/pending decisions

- Zarinpal merchant ID, public production callback URL and real request/verification acceptance.
- Real Kavenegar credentials/sender/template and SMS retry policy.
- Production acceptance of the selected Jalali datepicker across target mobile browsers.
- Hosting topology and capabilities at Pars Web Server (Docker, wildcard DNS/TLS, managed PostgreSQL/Redis, backups).
- Formal public performance budget and approved Persian/Latin font collection.
- Whether customer cancellation belongs in MVP; backend currently exposes staff cancellation, not a customer cancel endpoint.
- Production trust policy for the internal tenant-host forwarding header.

## Exact continuation instructions

1. Read `AGENTS.md` and all canonical docs.
2. Do not claim production readiness until the unchecked items in `docs/LAUNCH_CHECKLIST.md` pass with real credentials and the selected host.
3. Preserve the public, tenant-owner and platform surfaces plus strict platform/tenant RBAC separation.
4. Preserve the completed private media pipeline and do not broaden it into video or an unrestricted asset library.
5. Keep recurring billing, customer ordering/payments, unrelated product modules and marketing campaigns out of scope.

The next work is production activation, not a new product phase: obtain credentials, choose the host/domain, configure TLS/proxy/monitoring/backups, then execute the runbook and real-provider acceptance tests. Do not add post-MVP features during launch activation.
