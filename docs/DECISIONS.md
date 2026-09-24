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

- **Status:** partially superseded by D-039
- **Options:** fixed code prices; configurable plan records.
- **Decision:** toman; Silver default 1,900,000 and active; Golden default 2,900,000 and inactive; prices configurable and payment snapshots immutable.
- **Reasoning:** launch only what exists while allowing price changes.
- **Consequences:** The configurable prices and snapshot rule remain current. D-039 later activated Golden and introduced editable module flags; current feature availability must be read from plan data rather than this historical default.

## D-005 — Authentication and phone privacy

- **Status:** accepted
- **Options:** passwords/email; phone OTP.
- **Decision:** Iranian mobile OTP with no customer passwords; encrypted phone handling, masked logs and no public phone disclosure.
- **Reasoning:** lower friction for the target market and explicit privacy requirement.
- **Consequences:** SMS availability/rate limits/session security are critical.

## D-006 — SMS implementation order

- **Status:** superseded by D-045 and D-046
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

- **Status:** superseded by D-049
- **Options:** rely on conversation history; repository-owned handoff.
- **Decision:** each future phase runs in a separate chat; canonical specification, architecture, plan, progress and decisions live in the repository.
- **Reasoning:** prevents context dependence and reduces overwhelm.
- **Consequences:** every phase must update `docs/PROGRESS.md` and material decisions before completion.

## D-013 — Ordering and advanced features

- **Status:** partially superseded by D-029 and D-039
- **Options:** include ordering/Golden/multi-template/multi-branch at launch; postpone.
- **Decision:** postpone ordering, customer order payments, Golden modules, custom domains, multiple templates, full multi-branch UX, analytics, page builder and custom roles.
- **Reasoning:** keep first launch an achievable MVP.
- **Consequences:** This constrained the original MVP. Custom roles and online ordering were subsequently implemented; customer order payments, operational custom domains, multiple templates, full multi-branch UX, analytics, and page building remain outside the current product.

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

- **Status:** superseded by D-045 and D-046
- **Decision:** production and development use the same active provider interface. Development simulates OTP and confirmation delivery with masked logs; Kavenegar uses `verify/lookup` with approved template names and up to three tokens. Reservation confirmation creates one encrypted outbox row atomically with the status transition, retries three times with exponential backoff and never returns or logs the phone.
- **Reasoning:** commented production code would drift and cannot be tested. Configuration-based selection keeps the real path compiled and contract-tested while failing closed when production credentials are absent.
- **Consequences:** enabling real delivery requires only environment values and approved Kavenegar panel templates, followed by a real-provider acceptance test. The current API-hosted dispatcher is suitable for the bounded MVP but should move to a coordinated worker before horizontal scaling.

## P-001 — Production providers and hosting

- **Status:** partially superseded by D-045; hosting and real-provider acceptance remain pending
- **Options:** specific Iranian gateway/Kavenegar configuration and hosting topology, including Pars Web Server.
- **Decision:** Zarinpal was selected for subscription checkout and Kavenegar was initially selected for SMS; production credentials and hosting topology remained pending.
- **Reasoning:** credentials, contracts and hosting capabilities have not been supplied/verified.
- **Consequences:** D-045 replaced Kavenegar with sms.ir. Production SMS/payment acceptance and hosting topology are still unresolved external launch gates.

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

- **Status:** superseded by D-039 on 2026-09-09
- **Options:** copy phone values into every reservation row; continue hiding phones everywhere; expose the verified user's phone only through tenant-admin reservation endpoints.
- **Decision:** reservations keep storing the customer's entered full name as `contactName` and remain linked to the OTP-verified `users` row. Protected tenant reservation list/detail/status projections include `customerPhone` from that verified user, and the admin detail screen displays both full name and mobile number.
- **Reasoning:** the OTP flow already persists the normalized verified phone on the user, so duplicating it into reservations would add stale PII without improving the admin workflow.
- **Consequences:** This was the one-day transitional model. D-039 migrated reservation ownership from `users` to tenant-scoped `clients`; public/client responses still omit phone and protected tenant reservation views retain operational phone visibility.

## D-038 — Platform invoice visibility reuses payment intents

- **Status:** accepted and implemented on 2026-09-08
- **Options:** create a second platform invoice table; expose tenant invoice endpoints through tenant impersonation; add read-only platform invoice projections over `payment_intents`.
- **Decision:** platform invoice list/detail reads use the existing `payment_intents` records created by tenant renewal checkout. Platform detail enriches those records with cafe, primary branch and cafe admin/member data, guarded by both `subscriptions.manage` and `users.read`.
- **Reasoning:** payment intents already contain the immutable invoice snapshot, gateway identifiers, status, expiry and paid timestamp. Reusing them avoids a duplicate ledger and keeps full phone/contact visibility behind the existing protected platform user-read authority.
- **Consequences:** no migration is required. The platform view is read-only; refunds, manual status edits, scheduled invoice generation and recurring billing remain outside scope.

## D-039 — Plan-gated client ordering and reservation ownership

- **Status:** accepted and implemented on 2026-09-09
- **Options:** store cafe customers in `users`; create a new entitlement subsystem; use the existing subscription-plan `features` JSON with separate cafe-scoped clients.
- **Decision:** cafe customers are stored as tenant-scoped `clients` with unique `(coffee_shop_id, phone)` and separate rotating client auth sessions. Client OTP challenges reuse the existing OTP primitives but remain scoped by cafe and purpose. Plan modules are the existing plan `features` JSON keys: `reservations` and `onlineOrdering`, editable by platform admins. Orders are created only through server-side recalculation of menu ownership, availability, variants, prices, delivery settings and plan eligibility, with order-item and delivery-address snapshots for history.
- **Reasoning:** separating clients from administrative `users` preserves platform/tenant RBAC and allows the same phone number to be a customer of multiple cafes. Reusing plan features and OTP primitives is the smallest maintainable path and avoids a speculative entitlement or identity subsystem.
- **Consequences:** Migration defaults set Silver to reservations on/ordering off and Golden to both on, but platform operators can edit both module flags. Reservations belong to a `Client`, public creation requires client OTP, and protected tenant endpoints provide operational phone visibility. A client panel and address CRUD were later implemented; customer online payment and advanced payment/delivery pricing remain future work.

## D-040 — Tenant-branded client authentication and shared OTP entry

- **Status:** accepted and implemented on 2026-09-10
- **Decision:** Active tenant storefronts use a dedicated `/login` shell branded by the resolved café, with login and registration as two modes in one card. All admin and client authentication surfaces share one six-cell OTP component with digit normalization, paste and keyboard support, and guarded automatic submission after the sixth digit. Embedded checkout authentication consumes the checkout owner's client-session instance instead of creating an isolated session.
- **Reasoning:** The café identity should remain primary in the customer journey, and a single OTP interaction removes behavioral drift between standalone login, checkout, reservation and admin entry. Sharing the parent client session ensures successful authentication is observable immediately without a page refresh.
- **Consequences:** Existing client-auth routes, access/refresh token contracts, development SMS provider and database schema remain unchanged. Login verification sends no names, registration sends validated first and last names, switching modes preserves the phone but clears the challenge and OTP, and reduced-motion users receive the complete interface without entrance motion.
## D-041 — Checkout result route and tenant-preserving visual redesign

- **Status:** accepted and implemented on 2026-09-12
- **Decision:** reuse existing checkout/order APIs and cart auth, adding authenticated `/checkout/result` through `GET /public/orders/:id` and shared tenant styling.
- **Consequences:** no migration; invalid or unauthenticated links do not expose order data.

## D-042 — Courier availability and non-blocking auth modal

- **Status:** accepted and implemented on 2026-09-12
- **Decision:** enable courier by default/backfill through migration `1787799600000-EnableCourierDelivery`; show address only for courier and keep the auth modal centered without locking document scroll.

## D-043 — Toasts remain tenant-themed without transformed ancestors

- **Status:** accepted and implemented on 2026-09-13
- **Decision:** keep Toastify containers inside the tenant tree, change the shared section animation fill from `both` to `backwards`, and render `.Toastify` wrappers with `display: contents`.
- **Reasoning:** this preserves tenant CSS variables while removing fixed-position containing blocks and unwanted layout boxes.
- **Consequences:** future persistent `transform`, `filter`, or `contain` ancestors would require revisiting a body portal.

## D-044 — Website announcement banner removed

- **Status:** accepted and implemented on 2026-09-13
- **Decision:** remove the tenant announcement UI/DTO/entity field and drop `announcement_text` through migration `1787803200000-RemoveWebsiteAnnouncement` rather than hiding it.
- **Consequences:** prior announcement content was intentionally discarded; the original creation migration remains unchanged history.

## 2026-09-13 — Storefront footer map uses the keyless Google Maps embed

The footer location map uses the classic keyless Google Maps embed (`https://maps.google.com/maps?q=<lat>,<lng>&z=15&output=embed`) instead of the Maps Embed API or the Neshan SDK. This needs no API key, no environment variable and no new dependency, and it matches the existing Google Maps link already rendered in the `/#visit` section. The tradeoff is that Google tile availability depends on the client network in Iran; if that proves unreliable, switch the `src` to a Neshan embed, which is a one-line change localised to `TenantFooter`.

## D-045 - sms.ir verify adapter replaces the Kavenegar Lookup adapter

- **Status:** accepted and implemented on 2026-09-15
- **Options:** keep the Kavenegar adapter; run both adapters behind a provider switch; replace Kavenegar with an sms.ir adapter.
- **Decision:** the SMS panel is sms.ir. `SMS_PROVIDER=smsir` selects `SmsIrSmsProvider`, which calls `POST https://api.sms.ir/v1/send/verify` with the `x-api-key` header and a JSON body of `mobile`, `templateId` and named `parameters`. A send counts as delivered only when HTTP is successful, `status === 1` and `data.messageId` exists. Configuration uses `SMSIR_API_KEY`, numeric `SMSIR_OTP_TEMPLATE_ID`, and numeric environment keys matching each transactional notification type; production fails closed unless `SMS_PROVIDER=smsir`.
- **Reasoning:** the request, authentication header and success contract of the Kavenegar Lookup API differ from sms.ir, so an adapter cannot be shared; keeping the old adapter after the panel decision would be dead configuration. One provider at a time is the smallest change that remains truthful.
- **Consequences:** Kavenegar configuration/provider code was deleted. sms.ir parameter names must match approved templates and values are clamped to 25 characters. Provider-level errors may arrive as HTTP 400 with a status code, so transport and provider status are checked. Template titles are not accepted; every numeric panel ID is a launch prerequisite.

## D-046 - One encrypted outbox for all transactional SMS

- **Status:** accepted and implemented on 2026-09-17
- **Decision:** extend the existing encrypted `notification_deliveries` outbox instead of adding an event bus or BullMQ. Order, reservation, payment and subscription services enqueue typed tenant-scoped records with stable deduplication keys; one API-hosted dispatcher performs bounded retries and a one-minute scheduled sweep. Existing order/reservation settings hold the two opt-in owner alerts and the reservation reminder lead time.
- **Reasoning:** the repository already had the required durable delivery mechanism, phone encryption and provider abstraction. Generalizing it is smaller and safer than introducing a parallel notification stack or a queue dependency.
- **Consequences:** business writes do not wait for sms.ir, duplicate callbacks/sweeps cannot duplicate sends, and reminder/follow-up jobs recheck current state before delivery. All actual deliveries are asynchronous. Horizontal API scaling should move dispatch to the existing worker scaffold or add a coordinated claim strategy when production throughput requires it.

## D-047 - Platform consultation requests use the shared SMS outbox

- **Status:** accepted and implemented on 2026-09-18
- **Decision:** landing consultation submissions enqueue `REQUEST_COUNSELING` with the `customerName` parameter in the existing encrypted notification outbox. `notification_deliveries.coffee_shop_id` is nullable only for platform-owned notifications, and protected list/detail endpoints expose requests behind the new `consultation_requests.read` platform permission.
- **Reasoning:** the durable dispatcher, encryption, retries and sms.ir adapter already solve delivery; a second platform messaging path would duplicate infrastructure. A dedicated read permission keeps full phone access out of unrelated platform roles.
- **Consequences:** platform owners receive the permission through migration `1787814000000`; the `/platform` sidebar shows a searchable request list and decrypts the phone only in authorized detail responses. Production must configure the numeric sms.ir template ID in `REQUEST_COUNSELING`.

## D-048 - Admin-created reservations confirm through the shared placement path

- **Status:** accepted and implemented on 2026-09-18
- **Decision:** tenant staff create a reservation from the admin reservations screen by entering the customer phone, an optional name, date, time, party size and note. The API resolves the customer by normalized phone inside the tenant; when the phone is not yet a customer it creates one from the admin-supplied name (split on the first space) with `phone_verified_at` left null, then stores the reservation as `CONFIRMED` with the acting admin user in `status_changed_by_user_id` and enqueues `RESERVATION_PLACED_BY_ADMIN` with `customerName`, `cafeName`, `date`, `time` and `guestCount`. Public customer creation was refactored onto the same private `place` path so the availability advisory lock, slot validation and SMS enqueue exist once.
- **Reasoning:** the cafe is the actor, so an admin booking has nothing to review and must not require a second confirmation SMS; the customer phone is supplied by the guest and cannot be OTP-verified at the counter, so the customer row stays unverified until a real login. Reusing the existing placement, availability and outbox code is smaller and safer than a parallel flow.
- **Consequences:** the name is required only when the phone is not yet a customer of that tenant, and `contact_name` falls back to the stored customer name otherwise. Admin-created reservations do not enqueue `RESERVATION_PLACED_TO_ADMIN` because the admin is the author. `RESERVATION_PLACED_BY_ADMIN` must carry the numeric sms.ir panel id in production configuration.

## D-049 — Current-state documentation replaces phase documents

- **Status:** accepted and implemented on 2026-09-18
- **Options:** keep the original MVP/spec/phase plan and append more progress; archive every old file in-tree; replace competing current-state documents while preserving decisions in this log and Git history.
- **Decision:** `PRD.md` is the single current product source of truth. Focused architecture, security, domain, development, testing, operations, and current-state documents describe implemented behavior. The obsolete `MVP.md`, `PROJECT_SPEC.md`, `PLAN.md`, and giant `PROGRESS.md` are removed; this file remains the historical decision record.
- **Reasoning:** phase-era documents contradicted implemented ordering, clients, plans, providers, media, Docker, and operations and forced every agent to load duplicate history.
- **Consequences:** `AGENTS.md` routes changes to only the relevant documents. Git history retains implementation chronology; `CURRENT_STATE.md` carries only active blockers, debt, and next work. Documentation/code disagreement must be investigated rather than resolved by blindly trusting either source.
## D-050 — Delivered order value anchors Phase 0 analytics

- **Status:** implemented on 2026-09-23
- **Decision:** report delivered order value at the terminal status timestamp as `revenueToman`, with an explicit caveat that offline payment has no settlement proof. Use the existing cafe timezone and client identity, one tenant-filtered PostgreSQL aggregate, and a dedicated `analytics.read` permission. Keep all integer values as decimal strings.
- **Reasoning:** order totals and terminal states are the only trustworthy cafe-sales facts currently stored. Subscription payment records belong to platform billing and must not be mixed into cafe sales.
- **Consequences:** payment collection, refunds, historical status events, and trend charts require later schema and endpoints. [ANALYTICS.md](ANALYTICS.md) is the canonical technical reference and roadmap.

## D-051 — Analytics access follows configurable plan features

- **Status:** implemented on 2026-09-23
- **Decision:** `analytics` joins the existing plan feature registry; Golden is seeded `true` only when the key is absent. All tenant Analytics reads call the common entitlement resolver after administrative authorization. One Overview response includes zero-filled, local-time revenue/order/AOV series.
- **Reasoning:** plan names and a separate Analytics entitlement system would drift from platform-admin edits and subscription transitions. One grouped series query reuses the Phase 0 outcome timestamp and index.
- **Consequences:** plan admins can remove Analytics from Golden or grant it to another plan without code changes. [ANALYTICS.md](ANALYTICS.md) records the API and the Phase 2 starting point.

## D-052 — Time distributions reuse delivered outcome time

- **Status:** implemented on 2026-09-23
- **Decision:** group delivered orders by their `status_changed_at` converted to the cafe's IANA timezone. Return one period-specific distribution response with complete 24-hour, Saturday-first weekday, 7 × 24, and daily projections. Return all positive peak ties and exclude inactive dates from the weakest-date result.
- **Reasoning:** this preserves the Phase 0 revenue event and local date semantics while one tenant-filtered grouped query supplies all Phase 2 views.
- **Consequences:** a one-day range describes only that day; it is not evidence of a recurring weekly pattern. Calendar dates remain Gregorian in the API and display in Jalali in the owner UI. No migration or feature key was added.

## D-053 — Product analytics uses immutable sale lines and category snapshots

- **Status:** implemented on 2026-09-23
- **Decision:** aggregate Phase 3 product revenue, quantity, and containing-order counts from delivered `order_items`, keyed by stable menu item ID and falling back to the item-name snapshot only when the source no longer exists. Snapshot category ID/name on every new order item and report category-at-sale. Rank growth and decline by absolute revenue change while retaining the shared percentage comparison.
- **Reasoning:** current menu prices and current category relationships can change after a sale. Existing item price/name/variant snapshots already preserve product economics, while two category snapshot columns are the minimum schema change that prevents future category reclassification. Absolute change avoids promoting tiny percentage bases.
- **Consequences:** migration `1787828400000` best-effort backfills old categories from current menu relationships but cannot reconstruct category moves that predate the migration. Product/category revenue currently reconciles with Overview because orders contain no discounts or fees and totals equal line sums. Variant rows remain grouped under the parent product; variant/modifier reporting is deferred.

## D-054 — Inventory uses an immutable movement ledger and cached balance

- **Status:** implemented through Phase 1 on 2026-09-24
- **Decision:** add configurable `inventory` plan entitlement; model tenant-owned items/locations, signed immutable movement rows, and a numeric current-balance projection. Use composite tenant foreign keys and tenant-scoped idempotency uniqueness. Keep quantities and unit costs as `numeric(20,6)` decimal strings.
- **Reasoning:** inventory requires auditable history and cannot safely depend on a mutable quantity field. The existing subscription feature registry and `requireFeature` remain the only entitlement mechanism.
- **Consequences:** migration `1787832000000` seeds Golden only when the feature key is absent. Phase 1 adds transactionally posted operations, RBAC, tenant-scoped routes, counts, and immutable history. See [INVENTORY.md](INVENTORY.md).

## D-055 — Physical counts rebase against movements after each line is counted

- **Status:** implemented on 2026-09-24
- **Decision:** snapshot expected balance and timestamp when each count line is entered. On completion, target balance is counted quantity plus the sum of subsequent ledger movements; post a count adjustment from current balance to that target.
- **Reasoning:** stock movements recorded while staff physically count other items/areas remain reflected after reconciliation, without requiring the whole location to be locked for the count duration.
- **Consequences:** each line's physical value represents stock at its own submission time. Counts are one-way from draft to completed, and later changes require a new operational movement/count.

## D-056 — Recipes are tenant-scoped identities with immutable published versions

- **Status:** implemented on 2026-09-24
- **Decision:** attach optional recipes to existing menu item or variant IDs. Keep editable draft versions, normalized component quantities, creator/publisher attribution, activation timestamps, and immutable published history. A variant resolves its exact recipe first and may fall back to its item's base recipe. Recipe edits never change stock.
- **Reasoning:** stable target and version IDs let future orders preserve the exact recipe applied while reusing the existing unit converter and feature/permission system.
- **Consequences:** migration `1787844000000` adds tenant-scoped recipe tables and invariants. Version-number allocation and publication lock the recipe row; stale draft saves use a revision check. Removed menu variants become unavailable instead of being deleted so recipe/order references remain valid. Phase 3 must snapshot `recipeVersionId` on consumption; modifiers, prep recipes, costing, and stock deduction remain future work. See [INVENTORY.md](INVENTORY.md).

## D-057 — Order consumption and reversal share the order transition transaction

- **Status:** implemented on 2026-09-24
- **Decision:** consume stock on `UNDER_REVIEW → PREPARING`; reverse existing consumption on valid transitions to `CANCELED`. Run Order status, Inventory ledger/balance changes, and notification enqueue in the same PostgreSQL transaction. Keep the dependency one-way from Ordering to Inventory.
- **Reasoning:** `PREPARING` is the first staff-accepted operational status in UCafe's actual lifecycle. The existing state machine allows cancellation only before dispatch/delivery. Same-database atomicity avoids a confirmed order whose inventory operation is lost, and reversal must restore the quantities already posted regardless of current recipes or plan entitlement.
- **Consequences:** the order row lock serializes lifecycle transitions; an order-scoped advisory transaction lock, stable movement idempotency keys, partial unique indexes, tenant-scoped references, and a reversal validation trigger protect retries and concurrent requests. Optional missing recipes are observable and skipped; configured invalid recipes fail the whole transition before committing. Inventory-disabled tenants keep working ordering without stock movements. Only transitions after deployment are processed; no historical order backfill or modifier consumption is attempted. See [INVENTORY.md](INVENTORY.md).

## D-058 — Posted purchase receipts establish per-location moving average cost

- **Status:** implemented through Inventory Phase 4 on 2026-09-24
- **Decision:** keep supplier, PO, and receipt history inside Inventory. POs have tenant-safe atomic human-readable numbers and do not mutate stock. Posting a draft receipt appends generic `GOODS_RECEIPT`-sourced `PURCHASE_RECEIPT` movements and updates the existing item/location balance and average cost in one transaction. Actual line totals use integer toman; movement and balance unit costs use six-place numeric toman per normalized base unit. Receipts may be direct or PO-linked, partial, and explicitly over-received. Posted receipt history is immutable.
- **Reasoning:** actual receipt lines are the supplier price-history source, while the stock balance already defines the location-level projection and lock used by other stock mutations. This avoids a second price-history table or a parallel stock mutation path.
- **Consequences:** positive known-cost stock uses moving weighted average. Zero/negative or previously uncosted stock takes the new receipt cost as its average because a weighted result would fabricate or distort historical value. Existing stock is not backfilled with invented cost. Count-item packaging conversion and posted receipt reversal/cost correction remain deferred; manual quantity corrections do not rewrite the receipt or average cost. Migrations `1787854800000` and `1787858400000` encode these choices. See [INVENTORY.md](INVENTORY.md).

## D-059 — Waste is a reasoned ledger workflow with full-record compensation

- **Status:** implemented through Inventory Phase 5 on 2026-09-24
- **Decision:** capture waste in a tenant/location-scoped draft with structured reason and item lines. Posting creates immutable negative `WASTE` movements through the canonical inventory mutation path, snapshots current moving-average cost when known, and preserves the current balance average cost. Correct a mistaken post only by appending one positive compensation per original line and marking the whole record reversed; create a new record for the corrected amount.
- **Reasoning:** a dedicated source type retains operational loss meaning for later reports and keeps quantity, movement history, cost evidence and balances atomic. Reversal must never edit the original business event. Full-record correction is the smallest unambiguous policy for multi-item records.
- **Consequences:** one open or posted line per item in a record; repeated posting/reversal is idempotent. Unknown cost remains null. Reversal does not recreate a historical average-cost balance; it preserves whatever current average exists when quantity is restored. Migrations `1787862000000` and `1787865600000` enforce tenant links, complete posting, immutable movement links and complete compensations. See [INVENTORY.md](INVENTORY.md).

## D-060 — Minimum/PAR state and alerts are per location and use open PO commitments only for projection

- **Status:** implemented through Inventory Phase 5 on 2026-09-24
- **Decision:** store optional normalized minimum and target/PAR quantities per item/location. Compare current quantity deterministically: negative, zero, at-or-below minimum, below PAR, then OK. Persist one open negative/out/low alert per tenant/item/location and resolve it when stock recovers; reevaluate only the balance affected by a stock write or rule edit. For projected stock, add only each ordered/partially received PO line's remaining quantity at its expected location.
- **Reasoning:** existing balances and purchasing lines already establish location and lock boundaries. A partial unique index provides alert deduplication without a scheduler, message queue or repeated notification table. PAR gaps should not imply a forecast or automatically initiate purchasing.
- **Consequences:** `BELOW_PAR` is visible but does not open an alert. Alert severity can change during one open episode; recovery then a later crossing starts a new episode. Receipts at a different location do not reassign a PO's remaining expectation. There is no SMS/push delivery, forecast, or automatic replenishment. Migrations `1787862000000` and `1787865600000` add rules, alerts and expected PO locations. See [INVENTORY.md](INVENTORY.md).

## D-061 — Recipe profitability is a current default-location estimate

- **Status:** implemented on 2026-09-24
- **Decision:** calculate normalized recipe component quantities against the active default location's current moving-average costs. Use each variant's checkout price when variants exist; prefer its exact recipe, then fall back to the base recipe. Preserve unknown costs as null and show profit ratios only for positive selling prices.
- **Reasoning:** this reuses the existing per-location cost projection and checkout's established variant-pricing semantics without inventing historical prices or a second cost ledger.
- **Consequences:** draft and superseded versions also use current average cost/current menu prices and are explicitly estimates, not historical margin. Future order consumption snapshots known cost on new `SALE_CONSUMPTION` movements; reversals copy those snapshots and earlier sales remain unknown. Migration `1787869200000` enforces snapshot pairing and cost-safe reversal. Analytics realized sales remain separate; a future historical profitability report needs its own cost basis and both feature entitlements. See [INVENTORY.md](INVENTORY.md).
