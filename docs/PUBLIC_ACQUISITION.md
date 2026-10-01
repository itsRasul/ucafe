# Platform landing and public subscription purchase

The platform host serves a Persian RTL acquisition page and `/start` purchase flow. Tenant hosts keep their storefront and return 404 for these purchase routes. This is café subscription billing; customer order payment remains offline.

## Design and rendering

The landing shell and active-plan catalog are server-rendered. Client leaves handle the five-view product tour, catalog retry, mobile navigation, consultation and purchase forms. `tenant-public-data.ts` deduplicates reads within a request, with an eight-second upstream timeout; catalog reads are not persistently cached. Missing/empty catalog states offer retry and consultation instead of invented prices.

The warm cream/purple/tangerine identity uses the user's updated UCafe logo. `apps/web/src/app/ui/tokens.css` defines namespaced primitive values and opt-in `.ucafe-ui` semantic roles, typography, spacing, radii, shadows and motion. `Button`, `ButtonLink` and `SectionHeader` are shared by acquisition screens. The foundation does not replace tenant theme variables. Product previews explicitly label illustrative data; the mobile storefront image is an existing real product capture. No testimonials, customer metrics, recommendation flags, or demo-tenant links are fabricated.

[The design record](../apps/web/DESIGN.md) and its `.impeccable/design.json` sidecar document the built token system, supported components and responsive behavior for future opt-in adoption.

## Catalog contract

`GET /api/v1/public/platform/plans` returns `{ plans }` with active plans only, sorted by configured `sortOrder` and key. Each exposes key, name, description, decimal-string toman price, billing months, trial/grace days, order, registered boolean features with Persian labels, and enabled registered highlighted features. Only strict JSON `true` grants a feature. Unknown/internal JSON keys, plan UUIDs, timestamps and enforcement metadata are excluded. The registered feature catalog is the comparison's source of truth; no plan-name rules or separate feature flags exist in the browser.

The landing does not label a plan recommended: that field does not exist. Paid checkout does not start the configured trial. The FAQ explains that trials are started explicitly by Platform staff.

## Identity, scope and API

Purchase reuses administrative `/auth/otp/request`, `/auth/otp/verify`, `/auth/me` and `/auth/refresh`. Verified unknown numbers already create a User through that service. Administrative verification accepts only unscoped `LOGIN` challenges; client challenges cannot be redeemed for a User session. OTP hashing, expiry, attempts, rate limits, encrypted challenge phone, JWTs and refresh rotation remain shared.

All purchase APIs below require `AccessTokenGuard` and respond `private, no-store`:

| Endpoint under `/api/v1/public/platform/purchase` | Contract |
| --- | --- |
| `GET /availability?slug=...` | Bounded lowercase slug; configured hostname and advisory availability |
| `GET /drafts` | Authenticated member's latest unfinished café |
| `GET /cafes` | Up to 20 existing accessible cafés for admin navigation |
| `POST /prepare` | Café name, slug, active plan key; provisions/reuses draft and returns authoritative quote |
| `POST /:slug/checkout` | Existing checkout DTO with idempotency key, plan key, expected version and plan timestamp |
| `GET /:slug/invoices` | Owned café's bounded invoice list |
| `GET /:slug/invoices/:intentId` | Scoped invoice and minimal café/hostname projection |

DTOs reject extra owner identity, café IDs, prices and malformed hostname/UUID values. Protected financial reads/writes join active membership, tenant-scoped role and `subscription.checkout` permission. A slug is a locator, never authorization. The owner phone comes from the verified User row; browser input cannot bind another owner. Deleted slugs/domains remain unavailable because database uniqueness retains them.

## Purchase lifecycle

1. Select a current plan and verify the owner's phone through existing OTP.
2. Enter café name and a lowercase slug of at most 63 characters. Debounced availability is advisory; final uniqueness is enforced by existing provisioning and database constraints.
3. `prepare` takes a per-User transaction advisory lock, rechecks active verified identity and active plan, and calls `TenantsService.provision` with the same EntityManager. It creates the existing DRAFT café, primary Branch, Domain, website/reservation defaults and owner membership; no subscription is activated. Each verified User may have one unfinished café on this public path. A matching owned draft can be reused.
4. The server's shared subscription engine returns the payable quote. Review shows café, complete hostname, period and amount before gateway entry.
5. Checkout recalculates under the existing per-café subscription lock, requires initial PURCHASE on a DRAFT for this public path, rejects stale version/plan timestamp, and snapshots the authoritative price. Existing idempotency keys return their prior intent. No trial, manual activation or special public pricing path exists.
6. Callback verification uses the intent's unique authority and snapshotted rial amount. `applyPaidQuote` atomically records the unique financial payment and period, activates the subscription, publishes the café and queues the existing owner notification.
7. `/start/result` obtains the protected invoice from the server. Query status cannot declare success. Paid results link to identity/site setup, menu and storefront. Failed/canceled/expired states return to the same draft; pending invoices can resume. Existing café renewal remains in tenant admin.

The draft-before-payment choice preserves the existing café-owned intent and ledger model without adding a second checkout/order system or schema. Unpaid drafts do not resolve as public cafés. Unfinished draft cleanup and automated onboarding progress are future operational enhancements; this flow provides explicit next-step links only.

## Payment recovery and configured URLs

`PLATFORM_PUBLIC_URL` is the trusted public platform origin, including a local development port. It must contain no credentials, path, query or fragment; production requires HTTPS and the configured platform hostname. Compose supplies it to both API and web. PURCHASE returns to this origin's `/start/result`; later operations return to the persisted primary tenant hostname's admin result. Callback inputs cannot control the destination. No auth token or phone enters a redirect URL.

The callback locks its intent before claiming VERIFYING. A repeated callback during an active claim returns the current receipt without verifying again. Cancel/failure/expiry cannot overwrite PAID; an existing ledger payment repairs the intent to PAID. Settlement serializes through the same subscription lock as checkout. Checkout expires pending intents only, preserving an in-flight verification. Gateway request completion updates only a still-pending intent and cannot resurrect a terminal state. Verification claims older than five minutes may be reclaimed through the existing callback contract.

The platform refresh cookie is host-bound. Tenant admin entry safely asks for OTP on the tenant host again, rather than transferring credentials through URLs. Access tokens remain in session storage; refresh tokens stay HttpOnly.

## Consultation

The redesigned form continues posting the original validated payload to `/public/platform/order-requests`. Existing honeypot, hourly/deduplication limits, encrypted contact fields, durable request, Platform CRM Lead integration and notification transaction remain authoritative. A client submission guard prevents duplicate clicks; failure is actionable and success disables resubmission. Consultation is not a payment or subscription operation. Public purchase does not silently create CRM consultation Leads.

## Verification and production boundary

`public-purchase.spec.ts` supplies catalog/DTO/OTP-domain checks and an opt-in real PostgreSQL test of provisioning, ownership, stale quotes, competing requests, cancellation, verification failure, expiry, callback races and exactly-once activation. Run against a migrated development database:

```powershell
docker exec -w /ucafe/apps/api ucafe-api-1 sh -c 'export PUBLIC_PURCHASE_INTEGRATION_DATABASE_URL="$DATABASE_URL"; node --test -r ts-node/register src/payments/public-purchase.spec.ts'
npm run typecheck
npm test
npm run build
```

The integration fixture uses the existing simulated gateway and deletes only its own records after checking them. No migration is required. Real Zarinpal request/redirect/verification, merchant acceptance and financial recovery still require production credentials and a controlled provider test; development success is not production payment acceptance. See [PAYMENTS.md](PAYMENTS.md).

### Recorded verification — 2026-10-01

- Workspace `npm run typecheck` passed after the final build. Build and typecheck run sequentially because Next regenerates `.next/types`.
- Root `npm run build` passed for API, web and worker; `npm run build --workspace=@ucafe/web` passed again after the final shared button correction.
- The broad `npm test` runtime suite passed 238 API tests with 37 optional integration skips, and 29 web tests. That run used `TS_NODE_TRANSPILE_ONLY=1` to avoid repeated ts-node typechecking; the separate workspace typecheck covers source and specs.
- The focused real PostgreSQL purchase suite passed 4/4, including competing prepare/checkout requests, wrong-owner access, stale quotes, cancellation, failure, expiry, in-flight callback races and one ledger activation.
- Edge browser checks passed at 360, 390, 768, 1440 and 1920 pixels: no overflow, current catalog comparison, RTL tour keys, FAQ and mobile-menu Escape/focus behavior.
- Real local API checks passed consultation submission and its `LANDING_FORM` CRM Lead, existing OTP, malformed/available slug, server quote, simulated cancellation, forged success query remaining canceled, draft recovery, verified simulated payment and tenant-admin OTP handoff. Browser-supplied price was rejected with 400, and another owner's invoice was denied. The purchased tenant storefront served 200 while its `/start` returned 404/noindex.
- The fresh design reviewer scored all three material corrections resolved: mobile comparison disclosure cues, 44.33px OTP inputs at 360px, and danger-colored destructive hover. Its final `ship` verdicts cover those correction lists. Catalog-error and pending/verifying/failed/expired receipt presentations were reviewed in source, without dedicated visual captures.
- Destructive Button default, hover, active, keyboard focus and disabled states passed an isolated browser check; white-text contrast measured 6.90 and 8.09 for default/hover. Raster provenance scan passed 8/8; the one detector run returned no findings. `git diff --check` passed. This repository has no lint command.

Build output retains the existing Sentry configuration-import deprecation warning. Real-provider acceptance and production-scale performance have not been established by these local checks.
