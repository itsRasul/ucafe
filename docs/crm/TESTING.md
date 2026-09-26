# CRM testing plan

Phase 1 and Phase 2 add API unit, controller metadata, and PostgreSQL integration tests using the existing Node test runner, TypeScript, and node:assert. The web has typecheck/build checks but no durable component or browser E2E suite. See [TESTING.md](../TESTING.md).

Run `npm test --workspace=@ucafe/api` for the API suite. The PostgreSQL CRM integration cases require `CRM_INTEGRATION_DATABASE_URL` and use a dedicated database connection; without it, those cases are skipped. Run `npm run typecheck` and `npm run build` from the workspace root for the API and web.

Coverage includes canonical phone/email and URL/Instagram normalization, encrypted Contact/Lead PII and keyed lookup hashes, controller guards and per-route permissions, Organization/Contact/Lead persistence and filters, exact duplicate signals, tenant/source-request uniqueness, Lead lifecycle and conversion, status history, and archive/restore behavior.

## API tests by capability

- Unit-test DTO validation, normalized duplicate keys, Lead transition functions, terminal-state rejection, and unqualified reasons.
- Test organization-scoped Contact duplicate candidates and Tenant/source-request uniqueness. Do not rely on fuzzy matching for integrity.
- Integration-test every CRM migration against PostgreSQL, including its constraints, indexes, optional links, and forward-only behavior.
- Test platform permission guards for each route with allowed, missing, tenant-only, and wrong-scope users. Verify hidden navigation is not the security check.
- Verify archive and restore behavior, retained history, no cascade on Tenant archive/soft delete, and rejection of ordinary hard deletion.
- Test Lead conversion retries and conflicts with duplicate Organization/Contact candidates; assert one canonical conversion and preserved Lead history. Phase 2 creates no Deal.
- Test Lead status plus history atomicity, actor attribution, archived filtering, and duplicate source requests.
- The CRM Lead PostgreSQL integration checks manual create/encrypted PII, lifecycle guards, qualification, new Organization/Contact conversion, duplicate conflicts, existing Organization/Contact linking, idempotent conversion, archive filtering, and public-request/Lead rollback in a shared transaction.
- Contract-test read-only Tenant/Subscription/payment projections. CRM actions must not mutate subscription/payment state.

## Existing integration boundaries to protect

Retain coverage for platform consultation request DTO validation, encrypted phone storage, phone-free public response/list, authorized detail decryption, short-window repeat submission rejection, and REQUEST_COUNSELING outbox enqueue. Public request creation now tests the additive Lead call and honeypot non-creation; the PostgreSQL integration verifies the request and Lead share a rollback boundary. Source-request unique/idempotent linkage prevents a second Lead for the same request.

## UI checks for Phase 1/2

Manually verify desktop and small mobile widths, Persian RTL direction, keyboard and screen-reader labels, visible focus, touch targets, non-color status cues, loading/empty/error/success states, record deep links/back navigation, and reduced-motion behavior. Check that CRM permission loss yields a protected API response even if a page was loaded directly. The browser QA performed for this phase is recorded in [PROGRESS.md](../PROGRESS.md); authenticated mutation flows require a platform session.

Use the lightest focused tests while iterating, then the API suite, workspace typecheck/build, applied migration checks, and live route checks appropriate to the changed phase. No lint command exists today. Manual authenticated Lead CRUD and responsive browser interactions require an available platform session; record when that session is unavailable rather than claiming the flow was visually verified.
