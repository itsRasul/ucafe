# ucafe decision log

Entries distinguish confirmed decisions from pending questions. Dates reflect the repository checkpoint; earlier decisions are numbered where exact conversation dates were not retained.

## D-001 — Product and tenancy model

- **Status:** accepted
- **Options:** separate deployment/database per cafe; shared multi-tenant platform.
- **Decision:** one shared codebase and PostgreSQL database, scoped by coffee shop, with a platform subdomain and one primary branch for MVP.
- **Reasoning:** fastest manageable SaaS launch and avoids per-tenant frontend projects.
- **Consequences:** every query/relation needs tenant isolation; custom domains and full multi-branch UX are postponed.

## D-002 — Trial and prepaid subscription

- **Status:** accepted
- **Options:** no trial; setup fee plus monthly; postpaid month; trial plus prepaid subscription only.
- **Decision:** explicit seven-day trial, no setup fee, then payment in advance for one future calendar month.
- **Reasoning:** reduces purchase friction and billing complexity while preventing a month of unpaid use.
- **Consequences:** lifecycle reconciliation and data-preserving suspension/reactivation are required.

## D-003 — Grace and suspension

- **Status:** accepted
- **Options:** immediate paid-period suspension; indefinite access; seven-day grace.
- **Decision:** paid subscriptions receive seven days of grace, then suspend; unpaid trial expiry suspends without an extra paid grace assumption. Suspended sites show a controlled Persian unavailable page.
- **Reasoning:** practical tolerance for payment delays without exposing broken sites.
- **Consequences:** effective status may change during public access; data must remain intact.

## D-004 — Plans and currency

- **Status:** accepted
- **Options:** fixed code prices; configurable plan records.
- **Decision:** toman; Silver default 1,900,000 and active; Golden default 2,900,000 and inactive; prices configurable and payment snapshots immutable.
- **Reasoning:** launch only what exists while allowing price changes.
- **Consequences:** Golden UI/features must not be publicly usable yet.

## D-005 — Authentication and phone privacy

- **Status:** accepted
- **Options:** passwords/email; phone OTP.
- **Decision:** Iranian mobile OTP with no customer passwords; encrypted phone handling, masked logs and no public phone disclosure.
- **Reasoning:** lower friction for the target market and explicit privacy requirement.
- **Consequences:** SMS availability/rate limits/session security are critical.

## D-006 — SMS implementation order

- **Status:** accepted
- **Options:** block on real Kavenegar; development provider first.
- **Decision:** provider abstraction with development console OTP; add Kavenegar key/adapter later. Development provider must not run in production.
- **Reasoning:** enables local end-to-end work without credentials.
- **Consequences:** production launch is blocked until real provider/retry behavior is implemented.

## D-007 — Public visual direction

- **Status:** accepted
- **Options:** generic restaurant template; unrestricted builder; curated premium system.
- **Decision:** Persian-first warm editorial minimalism, mobile-first, one curated template and controlled tenant tokens/presets.
- **Reasoning:** visual quality is a primary sales mechanism while unrestricted customization would degrade quality/maintenance.
- **Consequences:** safe foreground calculation, accessible tokens and limited controls; multiple templates/page builder postponed.

## D-008 — MVP reservation model

- **Status:** accepted
- **Options:** physical table/floor assignment; request-and-confirm guest capacity.
- **Decision:** opening-hour slot generation, configurable concurrent guest capacity and pending owner-confirmed requests; no physical tables.
- **Reasoning:** sufficient for first launch and materially simpler.
- **Consequences:** availability is approximate capacity, and owner operations are required.

## D-009 — Reservation race control

- **Status:** accepted
- **Options:** UI-only availability; optimistic insert; transaction lock/recheck.
- **Decision:** PostgreSQL advisory transaction lock per branch/date plus capacity recheck on creation.
- **Reasoning:** prevents simultaneous overbooking without premature table inventory complexity.
- **Consequences:** PostgreSQL-specific implementation and a short serialized section.

## D-010 — Schema evolution

- **Status:** accepted
- **Options:** TypeORM synchronization; explicit migrations.
- **Decision:** synchronization disabled; all schema changes use reviewed TypeORM migrations and corrective migrations where already-applied code needs repair.
- **Reasoning:** deterministic, reviewable production changes.
- **Consequences:** entities and migrations must remain synchronized.

## D-011 — Same-origin client API integration

- **Status:** accepted and runtime-verified on 2026-08-27
- **Options:** enable browser CORS to port 3001; expose configured API URL; proxy through Next.js.
- **Decision:** interactive web calls use `/api/backend/[...path]`, forwarding to internal API and carrying tenant hostname via `x-ucafe-tenant-host`.
- **Reasoning:** avoids local CORS failure and matches a single-origin production topology.
- **Consequences:** the local availability, OTP and reservation flow works through the proxy; proxy/header trust must still be hardened in production.

## D-012 — Phase-per-chat workflow

- **Status:** accepted
- **Options:** rely on conversation history; repository-owned handoff.
- **Decision:** each future phase runs in a separate chat; canonical specification, architecture, plan, progress and decisions live in the repository.
- **Reasoning:** prevents context dependence and reduces overwhelm.
- **Consequences:** every phase must update `docs/PROGRESS.md` and material decisions before completion.

## D-013 — Ordering and advanced features

- **Status:** accepted
- **Options:** include ordering/Golden/multi-template/multi-branch at launch; postpone.
- **Decision:** postpone ordering, customer order payments, Golden modules, custom domains, multiple templates, full multi-branch UX, analytics, page builder and custom roles.
- **Reasoning:** keep first launch an achievable MVP.
- **Consequences:** architecture may prepare boundaries, but current phases must not implement these features.

## D-014 — Phase 7C owner authentication surface

- **Status:** accepted and runtime-verified on 2026-08-27
- **Options:** wait for the Phase 8A admin shell; add passwords; reuse phone OTP and tenant RBAC in a standalone reservation screen.
- **Decision:** `/admin/reservations` reuses the existing phone OTP endpoints and short-lived bearer access token, keeps the token in tab-scoped session storage, and relies on the existing hostname-scoped tenant permission guards. It does not introduce a general admin shell.
- **Reasoning:** reservation operations are required in Phase 7C, while navigation, shared session handling and the broader permission-aware shell belong to Phase 8A.
- **Consequences:** authorized owners and staff can manage reservations now; expired access tokens require OTP reauthentication until Phase 8A introduces shared refresh/session behavior.

## D-015 — Shared tenant admin session and access projection

- **Status:** accepted and implemented on 2026-08-27
- **Options:** repeat OTP/session logic per module; infer permissions from failed module calls; provide one shared admin session and tenant-scoped access projection.
- **Decision:** all `/admin` routes use one client session provider. Short-lived access tokens remain tab-scoped, while the existing rotating HttpOnly refresh cookie is forwarded through the same-origin proxy. A tenant-scoped authenticated endpoint returns only the active membership's granted permission keys and non-sensitive tenant context; subscription details use a separate `subscription.read`-guarded summary endpoint.
- **Reasoning:** the shell needs stable navigation and route states without duplicating authentication or guessing authorization, while database guards remain authoritative for every operation.
- **Consequences:** navigation and overview cards can be permission-aware, expired access can renew without another OTP, and no phone or role internals are exposed. The proxy rewrites the API refresh-cookie path to its same-origin auth path; production proxy trust remains a launch-hardening concern.

## D-016 — Curated owner editing surfaces

- **Status:** accepted and implemented on 2026-08-27
- **Options:** expose unrestricted page/CSS editing; build separate specialized apps; provide practical forms over existing tenant APIs.
- **Decision:** the shared owner shell contains two focused editors: one for approved website content/theme/contact/opening-hours fields and one for category/item/variant menu CRUD. Theme choices remain limited to validated colors, approved fonts and radius presets; menu deletion uses an explicit confirmation state.
- **Reasoning:** owners need complete daily control without allowing customization that can break accessibility, visual quality or tenant consistency.
- **Consequences:** site saves publish atomically through the existing tenant site endpoint; menu mutations use their existing granular endpoints; the same-origin proxy now forwards PUT and DELETE as well as GET/POST/PATCH. Media, arbitrary CSS, page building, ordering and bulk/reorder tooling remain outside Phase 8B.

## D-017 — Separate, audited platform operations surface

- **Status:** accepted and implemented on 2026-08-28
- **Options:** mix platform actions into tenant admin; rely only on server logs; build a separate permission-aware platform surface with durable audit events.
- **Decision:** `/platform` has its own access projection and never falls back to tenant membership. Provisioning, plan changes, trial starts, manual prepaid payments and lifecycle reconciliation require platform permissions, explicit UI confirmation for consequential actions and append an operator-attributed audit event.
- **Reasoning:** central operators need a small, high-confidence onboarding and billing workspace without exposing platform authority to cafe owners or introducing a full analytics system.
- **Consequences:** Phase 9 adds an append-only `platform_audit_events` table and read endpoint; payment snapshots still remain the financial source of truth. Automated billing, gateway settlement and broad analytics remain postponed.

## D-018 — Private, curated tenant media pipeline

- **Status:** accepted and implemented on 2026-08-28
- **Options:** public bucket/direct uploads; retain originals and expose an asset library; private storage behind scoped APIs with fixed variants.
- **Decision:** logo, hero and at most eight gallery images are stored in a private S3-compatible bucket under tenant/asset prefixes. The API decodes actual bytes, enforces byte/pixel/role dimensions, discards originals after generating fixed small/large WebP and AVIF variants, and publishes media only through hostname-resolved availability-guarded routes. Existing `site.manage` and `tenants.update` permissions govern tenant and platform operations separately.
- **Reasoning:** fixed outputs, private objects and existing curated-site permissions minimize tenant leakage, malicious uploads, layout instability and an unnecessary asset-library surface.
- **Consequences:** focal point and order are bounded database metadata; logo/hero replacement is atomic at the metadata layer; gallery count and key scope have database safeguards. Processing is synchronous until a future worker phase, video is unsupported, and orphan cleanup after an object-store outage remains operational maintenance.

## D-019 — Configurable Kavenegar Lookup with encrypted outbox simulation

- **Status:** accepted and implemented on 2026-08-28; real delivery pending credentials
- **Decision:** production and development use the same active provider interface. Development simulates OTP and confirmation delivery with masked logs; Kavenegar uses `verify/lookup` with approved template names and up to three tokens. Reservation confirmation creates one encrypted outbox row atomically with the status transition, retries three times with exponential backoff and never returns or logs the phone.
- **Reasoning:** commented production code would drift and cannot be tested. Configuration-based selection keeps the real path compiled and contract-tested while failing closed when production credentials are absent.
- **Consequences:** enabling real delivery requires only environment values and approved Kavenegar panel templates, followed by a real-provider acceptance test. The current API-hosted dispatcher is suitable for the bounded MVP but should move to a coordinated worker before horizontal scaling.

## P-001 — Production providers and hosting

- **Status:** pending
- **Options:** specific Iranian gateway/Kavenegar configuration and hosting topology, including Pars Web Server.
- **Decision:** Zarinpal is selected for subscription checkout and Kavenegar for SMS; production credentials and hosting topology remain pending.
- **Reasoning:** credentials, contracts and hosting capabilities have not been supplied/verified.
- **Consequences:** both providers have compiled, configuration-selected adapters and simulators, but production delivery/settlement remains blocked until credentials and real-provider acceptance tests are available.

## D-020 — Zarinpal-compatible prepaid checkout simulation

- **Status:** accepted and implemented on 2026-08-28; real settlement pending merchant ID
- **Decision:** the owner-only `subscription.checkout` flow creates a tenant-scoped, idempotent payment intent containing immutable Silver plan/price snapshots. Development uses a success-callback simulator; production selects the Zarinpal v4 adapter through validated environment configuration. The public callback identifies the opaque intent/authority pair, verifies the snapshotted rial amount server-side and records one prepaid subscription payment before immediate reactivation.
- **Reasoning:** commented-out production logic would not compile or remain contract-tested. A provider interface keeps simulation behavior structurally equivalent while allowing suspended tenants to reach an unscoped callback without weakening platform/tenant RBAC.
- **Consequences:** duplicate checkout keys return the same authority, repeated callbacks do not add credit, and Zarinpal code 101 is treated as an idempotent successful verification. Production activation requires `PAYMENT_PROVIDER=zarinpal`, a valid `ZARINPAL_MERCHANT_ID`, a public HTTPS callback base and a live acceptance test. Recurring billing, postpaid usage and customer order payments remain excluded.

## P-002 — Dedicated Jalali datepicker package

- **Status:** accepted and implemented on 2026-09-06
- **Options:** keep lightweight Jalali text entry; add a visual Jalali picker package.
- **Decision:** use `@majidh1/jalalidatepicker` for public reservation and tenant-admin reservation date fields.
- **Reasoning:** it is a small dependency-free Jalali datepicker and keeps the existing frontend ISO conversion boundary intact.
- **Consequences:** the picker displays/accepts Jalali dates, while API requests continue to send ISO `YYYY-MM-DD`; no schema migration is required.

## P-003 — Customer cancellation

- **Status:** pending
- **Options:** staff-only cancellation; authenticated self-service cancellation with policy window.
- **Decision:** none yet.
- **Reasoning:** cancellation instructions were desired in the UI direction, but an MVP customer policy was not confirmed.
- **Consequences:** current backend does not expose a customer cancellation endpoint.

## D-021 — Fail-closed production and authenticated internal routing

- **Status:** accepted and implemented on 2026-08-28
- **Decision:** production configuration refuses the development SMS provider, payment simulator and HTTP callbacks. The same-origin web proxy authenticates tenant-host forwarding with a constant-time checked shared internal secret; direct callers cannot select a tenant through the internal header. API/web security headers, opaque request IDs and structured metadata-only request logs are enabled.
- **Reasoning:** provider mocks and an unauthenticated routing override are acceptable development mechanisms but unsafe production defaults. The release must fail before serving traffic if real provider configuration is absent.
- **Consequences:** web and API require the same independently generated `INTERNAL_PROXY_SECRET`; the reverse proxy must strip both internal headers from public requests. Hosting must keep the API private except for deliberately routed public endpoints.

## D-022 — Observable readiness and verified recovery

- **Status:** accepted and implemented on 2026-08-28
- **Decision:** liveness remains shallow while `/health/ready` probes PostgreSQL, Redis and object storage. A PowerShell backup tool creates PostgreSQL custom dumps and a restore verifier uses a uniquely named disposable database, checks migration history, then removes only its temporary resources. Formal smoke, performance, accessibility, release and incident gates live in repository runbooks.
- **Reasoning:** a process being alive does not prove it can serve tenant requests, and an untested backup is not a recovery capability.
- **Consequences:** traffic orchestration must use readiness, operators must copy encrypted backups off-host and restore verification must run at least monthly. Object-storage snapshots/versioning remain a hosting responsibility.

## D-023 — Shared cinematic public storefront

- **Status:** accepted and implemented on 2026-08-29
- **Decision:** all active tenant subdomains continue to use one hostname-resolved SSR storefront, now expressed as a Persian-first AIDA narrative with an asymmetric hero, dense story/contact/hours composition, optional horizontal media gallery, stacked menu presentation and a final reservation action. Tenant content, approved theme tokens, media, menu, hours and contact data remain authoritative. GSAP enhances scroll reveals and stacking on the client while reduced-motion users receive the complete static presentation.
- **Reasoning:** the public website is the tenant's primary sales surface and needed a more distinctive modern identity without creating per-cafe deployments, adding a template builder or weakening the curated customization boundary.
- **Consequences:** every coffee shop receives the redesign automatically; tenants without hero/gallery media retain a designed abstract fallback. The public page now carries a small client motion dependency, so reduced-motion behavior and mobile/browser performance remain required release checks.

## D-024 — Reference-aligned coffee-house presentation

- **Status:** accepted and implemented on 2026-09-01
- **Decision:** refine the shared public storefront to follow the supplied local `coffee` project’s recognizable composition: a full-bleed photographic hero with overlaid navigation, a dark espresso and warm cream palette, restrained glass details, direct about/features/menu/gallery/hours/contact sections and a prominent reservation action. Tenant content, approved theme tokens, private media variants, live menu data, opening hours and contact information remain authoritative.
- **Reasoning:** the supplied reference communicates a familiar premium coffee-house atmosphere more directly than the previous experimental split hero and oversized editorial transitions, while remaining compatible with the curated multi-tenant template.
- **Consequences:** all active tenant subdomains share the reference-aligned landing page without a new template or page builder. The WebGL hero enhancement is no longer rendered on the storefront; GSAP remains limited to lightweight entrance and photographic parallax motion with a complete reduced-motion fallback.

## D-025 — Self-hosted Vazir typography and restrained type scale

- **Status:** accepted and implemented on 2026-09-02
- **Decision:** use the user-supplied Vazir 16.1 WOFF2 files as the project-wide interface and display typeface on public, reservation, tenant-admin and platform pages. Serve Light, Regular, Medium and Bold weights locally from the web app, and cap responsive headings at substantially smaller sizes than the prior cinematic scale.
- **Reasoning:** one Persian-first font creates consistent glyph metrics and hierarchy across every product surface, while the previous oversized headings consumed too much viewport space and felt disproportionate, especially on mobile.
- **Consequences:** curated tenant heading/body font values remain stored for compatibility but the shared storefront presentation resolves both to Vazir. The Docker web image must copy `apps/web/public` so fonts and existing fallback media are available in standalone deployments; the included Vazir license is retained beside the font files.

## D-026 — Menu-item images reuse the private media pipeline

- **Status:** accepted and implemented on 2026-09-02
- **Decision:** each menu item may own one active tenant-scoped `MENU_ITEM` media asset. Owners upload, replace, reposition or remove it from the existing menu editor; the API produces fixed square WebP/AVIF variants and includes the image projection in tenant and public menu responses. Public featured cards and every full-menu row render the uploaded image, with the curated menu fallback preserving layout for legacy items without an upload.
- **Reasoning:** extending the established private media pipeline preserves validation, tenant isolation, optimized delivery and consistent admin behavior without storing arbitrary URLs or creating another asset system.
- **Consequences:** menu-item images require at least 600×600 JPEG, PNG or WebP sources and originals are discarded after processing. A database constraint and trigger enforce one active image per item and matching tenant ownership; deleting a menu item also removes its active media objects.

## D-027 — Dedicated searchable public menu and item deep links

- **Status:** accepted and implemented on 2026-09-03
- **Decision:** active tenant storefronts expose the complete menu on an SSR `/menu` route that reuses the landing page's hostname resolution, branding, header, footer, media and suspension rules. The landing page retains only featured items. The dedicated page provides client-side Persian-normalized search, sticky category navigation with smooth scrolling, responsive image-led cards and native item-detail dialogs. Public item links use `/menu?item=<item-id>`; closing a dialog removes the parameter and browser Back closes a newly opened item naturally.
- **Reasoning:** a focused menu surface gives guests faster browsing and shareable item details without overloading the storytelling landing page or introducing ordering behavior before the product supports it.
- **Consequences:** category and item order, variants, prices, featured state and availability remain controlled by the existing public menu projection, so no schema or API contract changed. Invalid item identifiers fall back safely to the menu page, unavailable items remain visible and labeled, and cart, ordering and nutritional data remain outside scope.

## D-028 — Separate platform marketing home and privacy-safe order requests

- **Status:** accepted and implemented on 2026-09-03
- **Decision:** the base ucafe hostname renders a dedicated Persian-first agency/platform landing page while tenant subdomains retain the shared coffee-shop storefront. The public landing reads the active Silver price from subscription-plan data and accepts consultation/order requests through a separate unauthenticated platform endpoint. Each request stores normalized mobile data using the existing authenticated-encryption and blind-hash primitives, starts in `NEW`, and exposes no phone data in its response.
- **Reasoning:** ucafe needs its own acquisition surface without mixing platform messaging into tenant storefronts, and future operators need durable leads even though the management UI and automated payment flow are postponed. Reusing the existing plan and cryptography sources avoids price drift and a second PII design.
- **Consequences:** public requests are DTO-validated, honeypot-filtered and rate-limited per phone hash over a short duplicate window. The current form creates neither a tenant nor a payment; viewing, decrypting and transitioning requests requires a future permission-protected platform-admin phase. The base-domain design carries a small GSAP client enhancement with a complete reduced-motion fallback.

## D-029 — Fixed permission catalog with scoped custom roles

- **Status:** accepted and implemented on 2026-09-03
- **Decision:** the platform control center may create tenant-specific or global platform custom roles and assign existing same-scope permissions. Permission definitions remain code-managed; direct user permission overrides are excluded.
- **Reasoning:** this provides the required operational flexibility while keeping authorization keys reviewable and preventing platform/tenant scope mixing.
- **Consequences:** system/protected role identity and deletion are immutable, assigned custom roles cannot be deleted, user blocking revokes sessions, and platform-owner self/last-owner lockout is rejected. Permission assignment behavior is expanded by D-030.

## D-030 — Platform-managed users and mutable role permissions

- **Status:** accepted and implemented on 2026-09-04
- **Decision:** a `users.manage` operator may create a phone user with one initial platform or tenant role, and a `roles.manage` operator may replace the same-scope permission assignments of any role. Protected/system role names, keys and deletion remain immutable, and a platform-role change is rejected if no active operator would retain both role-management and permission-catalog access. The protected platform user list/detail now returns complete phone values.
- **Reasoning:** platform owners need practical account onboarding and permission control over the seeded roles as well as custom roles; the prior mask and system-role lock prevented those operations.
- **Consequences:** tenant-role user creation also creates an invited membership for the selected coffee shop and OTP verification activates it. User creation and role changes are transactional and audited without phone values. Full phones remain confined to `users.read`-guarded platform endpoints; public/reservation responses and logs retain their existing privacy rules.

## D-031 — Platform rebrand to ucafe

- **Status:** accepted and implemented on 2026-09-05
- **Decision:** replace the former English/Persian product name across the repository with `ucafe` and `یو کافه`; domain-like examples and environment defaults use the hyphenated `u-cafe` form, including `u-cafe.ir` and `u-cafe.localhost`.
- **Reasoning:** the product brand and production domain changed, so visible copy, package/workspace names, Docker defaults, scripts, internal keys and documentation should no longer carry the old platform identity.
- **Consequences:** existing local Docker volumes/databases created under the old Compose project or database names may need a deliberate migration or recreation before live local containers use the new defaults. The source code itself does not add a schema migration for this rename.

## D-032 — Jalali reservation date boundary

- **Status:** accepted and implemented on 2026-09-05
- **Options:** keep Gregorian ISO inputs; use Jalali UI values while preserving ISO API/database values; migrate persistence to Jalali strings.
- **Decision:** reservation public and tenant-admin screens accept/display Jalali dates, converting at the frontend boundary to the existing ISO `YYYY-MM-DD` API contract.
- **Reasoning:** Persian-first reservation UX needs Jalali dates, while availability rules, PostgreSQL date storage and existing tests already rely on ISO values.
- **Consequences:** no schema migration is required. Backend DTOs, capacity locks and filters stay unchanged; future visual datepicker packages must still submit ISO values to the API.

## D-033 — Reference-matched owner admin visual system

- **Status:** accepted and implemented on 2026-09-06
- **Decision:** redesign only the tenant owner/staff admin under `/admin` as a compact Persian RTL SaaS console closely matching the supplied light reference: pale sidebar, top toolbar, cyan active states, thin dividers, dense panels and restrained controls.
- **Reasoning:** cafe owners need the existing operational workflows to feel clearer and more professional without changing product behavior or mixing platform administration into tenant management.
- **Consequences:** the change is frontend visual/structural only. Existing owner-admin routes, permission filtering, OTP/session behavior, Jalali date UI boundary, site/media/menu/reservation/subscription API calls, platform admin and public storefront behavior remain unchanged; no schema migration is required.

## D-034 — Reference-matched platform admin visual system

- **Status:** accepted and implemented on 2026-09-06
- **Decision:** redesign only the platform admin under `/platform` as a compact Persian RTL SaaS control center matching the supplied light reference: pale sidebar, compact topbar/search, cyan active states, dense list/detail operations, restrained status badges, refreshed entry/login states and mobile bottom navigation.
- **Reasoning:** platform operators need provisioning, subscription, user, role and audit workflows to feel clearer and more operationally polished without changing platform authority, tenant isolation or backend contracts.
- **Consequences:** the change is frontend visual/structural only. Existing platform views, OTP/session handling, permission filtering, tenant provisioning, subscription lifecycle, plan, user, role, permission-catalog and audit API calls remain unchanged; `/admin`, public storefronts, schemas and migrations are untouched.

## D-035 — Shared ucafe logo asset

- **Status:** accepted and implemented on 2026-09-06
- **Decision:** use the user-supplied transparent SVG logo as the shared visible ucafe brand asset across the platform landing, tenant storefront fallback branding, unavailable state, owner admin, platform admin and authentication entry states. Keep small generated PNG fallbacks for favicon/apple-touch metadata.
- **Reasoning:** one canonical displayed asset avoids mismatched text/CSS placeholder marks while the SVG wrapper lets layout scale the supplied transparent logo consistently.
- **Consequences:** tenant-uploaded cafe logos still take precedence in tenant public header/footer where available; the shared ucafe mark appears only where the platform brand or fallback logo is needed. No schema, API or media-upload behavior changes are required.

## D-036 — Owner renewal invoices use payment intents

- **Status:** accepted and implemented on 2026-09-08
- **Options:** separate invoice ledger; scheduled pre-invoice generation; reuse checkout payment intents as owner-facing invoices.
- **Decision:** tenant-owner subscription renewal uses on-demand `payment_intents` as invoices. The owner creates a renewal invoice from `/admin/subscription`, reviews it before payment, pays through Zarinpal, and returns to an admin-styled result page after server-side callback verification. `/admin/invoices` lists recent payment intents as invoice history.
- **Reasoning:** the existing checkout model already stores immutable plan/price snapshots, status, authority, expiration, provider reference and idempotency. Reusing it avoids another billing table and avoids introducing scheduled jobs before the product needs them.
- **Consequences:** only pending unexpired intents expose a payment URL; failed or expired callbacks do not renew the subscription; successful verification still records one prepaid month and immediately reactivates the cafe. Automatic pre-invoice generation, recurring billing, refunds UI and Golden upgrades remain out of scope.

## D-037 — Tenant-admin reservation contact visibility

- **Status:** accepted and implemented on 2026-09-08
- **Options:** copy phone values into every reservation row; continue hiding phones everywhere; expose the verified user's phone only through tenant-admin reservation endpoints.
- **Decision:** reservations keep storing the customer's entered full name as `contactName` and remain linked to the OTP-verified `users` row. Protected tenant reservation list/detail/status projections include `customerPhone` from that verified user, and the admin detail screen displays both full name and mobile number.
- **Reasoning:** the OTP flow already persists the normalized verified phone on the user, so duplicating it into reservations would add stale PII without improving the admin workflow.
- **Consequences:** no schema migration is required. Public reservation creation responses and customer `mine` responses still omit phone data; phone visibility is limited to tenant users with `reservations.read`.

## D-038 — Platform invoice visibility reuses payment intents

- **Status:** accepted and implemented on 2026-09-08
- **Options:** create a second platform invoice table; expose tenant invoice endpoints through tenant impersonation; add read-only platform invoice projections over `payment_intents`.
- **Decision:** platform invoice list/detail reads use the existing `payment_intents` records created by tenant renewal checkout. Platform detail enriches those records with cafe, primary branch and cafe admin/member data, guarded by both `subscriptions.manage` and `users.read`.
- **Reasoning:** payment intents already contain the immutable invoice snapshot, gateway identifiers, status, expiry and paid timestamp. Reusing them avoids a duplicate ledger and keeps full phone/contact visibility behind the existing protected platform user-read authority.
- **Consequences:** no migration is required. The platform view is read-only; refunds, manual status edits, scheduled invoice generation and recurring billing remain outside scope.
