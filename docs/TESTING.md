# Testing

## Current automated checks

The API uses Node's built-in test runner with `ts-node/register`; no Jest setup exists. The explicit package script covers environment fail-closed behavior, sms.ir contracts, host/proxy trust, authorization guards, auth crypto/tokens/phone, client authentication/panel logic, subscription lifecycle/features, site/menu rules, reservation time rules, order transitions, analytics periods/comparisons, notification formatting, media validation/storage behavior, payment gateways, consultation requests, and platform access. Analytics SQL isolation and aggregation run against PostgreSQL when `ANALYTICS_INTEGRATION_DATABASE_URL` is set; the fixture rolls back.

The web and worker have typecheck/build scripts but no automated component/browser test suite. The root scripts run workspace checks where present:

```powershell
npm run typecheck
npm test
npm run build
```

There is no lint script and no durable Playwright/Cypress-style E2E suite.

## Current result

On 2026-09-23, the API suite passed all 81 tests with the Analytics PostgreSQL integration tests enabled; root workspace typechecks and API/web builds passed. Phase 1 Analytics was also checked in the local authenticated owner UI at desktop and 375 px mobile widths, including seven-day and hourly trends, empty data, and a custom Jalali range. The existing Silver tenant showed the locked Analytics state through a server 403. The Compose database has migration `1787824800000` applied, Golden has `analytics=true`, and Silver has no Analytics entitlement.

## Migration and live checks

For schema/integration work:

```powershell
npm run migration:show --workspace=@ucafe/api
npm run migration:run --workspace=@ucafe/api
docker compose --env-file .env.development -f compose.yaml -f compose.dev.yaml ps
```

Use `scripts/smoke.ps1` for local readiness, web health, tenant SSR, security headers, and the 250 KiB HTML budget after setting an existing tenant host. Backup/restore behavior is checked with `scripts/backup.ps1` and `scripts/verify-restore.ps1` against a disposable database.

## Manual/browser expectations

UI work needs mobile and desktop verification for Persian/RTL semantics, keyboard/focus/labels, touch targets, horizontal overflow, loading/empty/error/success states, console errors, and `prefers-reduced-motion`. Exercise tenant, client, owner, and platform surfaces relevant to the change; a build is not a visual test.

## High-risk regression areas

- wrong-host/wrong-tenant resource IDs and authenticated proxy-header forgery
- platform versus tenant permission separation and protected-role safeguards
- client ownership across cafe, client, address, order, and reservation
- server-side order prices and order idempotency
- reservation concurrency/capacity and transition locking
- payment authority/amount verification, duplicate callbacks, stale verifying recovery, and no double credit
- notification encryption, deduplication, retry exhaustion, and scheduled eligibility
- production refusal of simulators/HTTP callback
- media spoofing, size/pixel/dimension limits, and tenant object-key scope

Run the smallest focused check while iterating, but finish cross-domain/security work with the full applicable suite, typechecks/builds, migrations, and live Docker path.

