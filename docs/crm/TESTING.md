# CRM testing plan

Phases 1–6 add API unit, controller metadata, and PostgreSQL integration tests using the existing Node test runner, TypeScript, and node:assert. The web has typecheck/build checks but no durable component or browser E2E suite. See [TESTING.md](../TESTING.md).

Run `npm test --workspace=@ucafe/api` for the API suite. The PostgreSQL CRM integration cases require `CRM_INTEGRATION_DATABASE_URL` and use a dedicated database connection; without it, those cases are skipped. Run `npm run typecheck` and `npm run build` from the workspace root for the API and web.

Coverage includes canonical phone/email and URL/Instagram normalization, encrypted Contact/Lead PII and keyed lookup hashes, controller guards and per-route permissions, Organization/Contact/Lead/Deal/Activity/Task/Note persistence and filters, exact duplicate signals, tenant/source-request/Lead-origin uniqueness, Lead lifecycle/conversion, Deal stage/outcome lifecycle, Task lifecycle and derived overdue state, cross-Organization work-link rejection, append-only histories, audit privacy, and archive/restore behavior.

## API tests by capability

- Unit-test DTO validation, normalized duplicate keys, Lead transition functions, terminal-state rejection, and unqualified reasons.
- Test organization-scoped Contact duplicate candidates and Tenant/source-request uniqueness. Do not rely on fuzzy matching for integrity.
- Integration-test every CRM migration against PostgreSQL, including its constraints, indexes, optional links, and forward-only behavior.
- Test platform permission guards for each route with allowed, missing, tenant-only, and wrong-scope users. Verify hidden navigation is not the security check.
- Verify archive and restore behavior, retained history, no cascade on Tenant archive/soft delete, and rejection of ordinary hard deletion.
- Test Lead conversion retries and conflicts with duplicate Organization/Contact candidates; assert one canonical conversion and preserved Lead history. Phase 2 creates no Deal.
- Test Lead status plus history atomicity, actor attribution, archived filtering, and duplicate source requests.
- Test Deal stage ordering, skip/backtrack reasons, stale-stage rejection, won/lost terminal rules, loss reasons, same-Organization Contact and qualified/converted-Lead constraints, estimate/date validation, stage totals, and history/audit atomicity.
- The CRM Deal PostgreSQL integration creates and converts linked records, checks single-origin enforcement and stage history, moves stages, closes Won/Lost, exercises filters, and verifies archive/restore.
- The CRM work PostgreSQL integration covers Activity/Task/Note persistence, allowed and cross-Organization associations, Lead-only work across conversion, Task assignment/filter/lifecycle/archive rules, audit privacy, and archive restoration.
- The Phase 5 CRM PostgreSQL integration covers a mixed-source Timeline, equal-time stable order, category/date filters, offset page traversal, pre-conversion Lead history, relationship-based Activity deduplication, organization isolation, selected Task audit lifecycle entries, Deal outcome timestamps, archived source/Organization reads, Note current-source content, and derived 360 summary/bounded previews.
- Phase 6 tests explicit Tenant link/unlink uniqueness, idempotency, candidate visibility, and transactional audit facts; the CRM customer-context integration verifies Tenant and active Trial reads, trial conversion, successful-payment Timeline facts, and that context reads do not mutate Subscription state. Controller metadata checks enforce `subscriptions.read` for the customer context and mixed Timeline.
- The CRM Lead PostgreSQL integration checks manual create/encrypted PII, lifecycle guards, qualification, new Organization/Contact conversion, duplicate conflicts, existing Organization/Contact linking, idempotent conversion, archive filtering, and public-request/Lead rollback in a shared transaction.
- Contract-test read-only Tenant/Subscription projections and only the explicitly safe payment Timeline fields. CRM actions must not mutate subscription/payment state or expose amount/provider identifiers.

## Existing integration boundaries to protect

Retain coverage for platform consultation request DTO validation, encrypted phone storage, phone-free public response/list, authorized detail decryption, short-window repeat submission rejection, and REQUEST_COUNSELING outbox enqueue. Public request creation now tests the additive Lead call and honeypot non-creation; the PostgreSQL integration verifies the request and Lead share a rollback boundary. Source-request unique/idempotent linkage prevents a second Lead for the same request.

## UI checks for Phase 1–6

Manually verify desktop and small mobile widths, Persian RTL direction, keyboard and screen-reader labels, visible focus, touch targets, non-color status cues, loading/empty/error/success states, record deep links/back navigation, and reduced-motion behavior. For Organization 360 verify Timeline category/date filters, customer facts, Tenant navigation, explicit link/unlink, independent overview/context/Timeline errors, and that sales Expected Plan remains distinct from actual Subscription Plan. Check `crm.manage`, `tenants.read`, and `subscriptions.read` independently and verify protected API responses when a page is loaded directly. The browser QA performed for this phase is recorded in [PROGRESS.md](../PROGRESS.md); authenticated mutation flows require a platform session.

Use the lightest focused tests while iterating, then the API suite, workspace typecheck/build, applied migration checks, and live route checks appropriate to the changed phase. No lint command exists today. Manual authenticated CRM work CRUD and responsive browser interactions require an available platform session; record when that session is unavailable rather than claiming the flow was visually verified.
