# CRM testing plan

Phases 1–10 add API unit, controller metadata, and PostgreSQL integration tests using the existing Node test runner, TypeScript, and node:assert. The web has typecheck/build checks but no durable component or browser E2E suite. See [TESTING.md](../TESTING.md).

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
- Test the Phase 7 filter compiler with parameterized hostile values, rejected unknown fields/operators, field-specific select-option validation, multi-select containment, active Tag criteria, AND/OR grouping, and condition limits. Exercise typed values, partial required-field PATCH behavior, option ownership/stable IDs, archived-value retention, Tag normalization/assignment, private/shared view visibility and rename, metadata/read-write permission guards, and dynamic Segment counts against current records.
- Verify list filtering is applied in SQL before limit/offset, that Segments store criteria rather than members, and that audit summaries omit custom values and Tag names.
- Verify score boundaries and formula, negative points, contribution ordering/explanation, no recursive score criteria, per-route scoring permissions, invalid archived criteria warnings, configuration version increments, unchanged-history suppression, actual-change history, converted/archive retention, and score filter/sort parity in Lead lists, Saved Views, and Segments.
- The Phase 8 PostgreSQL scoring integration verifies rule creation/update, activity-derived matching, persisted component/overall values, manual Priority independence, explanation/history idempotency, and filtered/sorted Lead list behavior. Add fixture coverage for each new signal or invalidation source when the field registry grows.
- The CRM Deal PostgreSQL integration creates and converts linked records, checks single-origin enforcement and stage history, moves stages, closes Won/Lost, exercises filters, and verifies archive/restore.
- The CRM work PostgreSQL integration covers Activity/Task/Note persistence, allowed and cross-Organization associations, Lead-only work across conversion, Task assignment/filter/lifecycle/archive rules, audit privacy, and archive restoration.
- The Phase 5 CRM PostgreSQL integration covers a mixed-source Timeline, equal-time stable order, category/date filters, offset page traversal, pre-conversion Lead history, relationship-based Activity deduplication, organization isolation, selected Task audit lifecycle entries, Deal outcome timestamps, archived source/Organization reads, Note current-source content, and derived 360 summary/bounded previews.
- Phase 6 tests explicit Tenant link/unlink uniqueness, idempotency, candidate visibility, and transactional audit facts; the CRM customer-context integration verifies Tenant and active Trial reads, trial conversion, successful-payment Timeline facts, and that context reads do not mutate Subscription state. Controller metadata checks enforce `subscriptions.read` for the customer context and mixed Timeline.
- The CRM Lead PostgreSQL integration checks manual create/encrypted PII, lifecycle guards, qualification, new Organization/Contact conversion, duplicate conflicts, existing Organization/Contact linking, idempotent conversion, archive filtering, and public-request/Lead rollback in a shared transaction.
- Contract-test read-only Tenant/Subscription projections and only the explicitly safe payment Timeline fields. CRM actions must not mutate subscription/payment state or expose amount/provider identifiers.

## Existing integration boundaries to protect

Retain coverage for platform consultation request DTO validation, encrypted phone storage, phone-free public response/list, authorized detail decryption, short-window repeat submission rejection, and REQUEST_COUNSELING outbox enqueue. Public request creation now tests the additive Lead call and honeypot non-creation; the PostgreSQL integration verifies the request and Lead share a rollback boundary. Source-request unique/idempotent linkage prevents a second Lead for the same request.

## UI checks for Phase 1–8

Manually verify desktop and small mobile widths, Persian RTL direction, keyboard and screen-reader labels, visible focus, touch targets, non-color status cues, loading/empty/error/success states, record deep links/back navigation, and reduced-motion behavior. For Organization 360 verify Timeline category/date filters, customer facts, Tenant navigation, explicit link/unlink, independent overview/context/Timeline errors, and that sales Expected Plan remains distinct from actual Subscription Plan. Check `crm.manage`, `tenants.read`, and `subscriptions.read` independently and verify protected API responses when a page is loaded directly. The browser QA performed for this phase is recorded in [PROGRESS.md](../PROGRESS.md); authenticated mutation flows require a platform session.

For Phase 8, verify score and Priority are separately labeled, breakdown values are deterministic and readable, missing rules show unconfigured state, invalid rules explain why they no longer contribute, disabled/archive actions are explicit, the rule builder excludes score fields, and the rule/Lead screens remain usable at narrow widths with keyboard and screen-reader support.

## Phase 9 Workflow coverage

- Verify Workflow DTO allowlists, trigger/action config validation, enable-capacity locks, route guard metadata, and `crm.read` versus `crm.manage` behavior.
- Integration-test transactional outbox writes, filter-criteria match/miss (including Tags, custom fields, and Lead scores as the registry grows), one execution per `(workflow,event)`, and action order.
- Replay the same source key and verify no second execution/Task/Tag assignment. Test Tag/owner no-ops and that Task creation, its action result, and `automation_action_execution_id` commit/roll back together.
- Inject transient and permanent failures. Verify three automatic attempts/backoff, recovery of stale claims after restart, successful actions are not repeated, later actions stop after failure, and manual retry is bounded.
- Test PostgreSQL `UPDATE ... RETURNING` recovery results in both shapes: zero affected rows produce no warning, returned events log the actual IDs, and stale action recovery propagates `RETRYING`/`FAILED` to its parent execution. Integration-test a stale event with no matching Workflow, a false condition, terminal recovery at max attempts, and repeated polling after terminal state.
- Keep stale threshold checks distinct from the five-second poll: an event claimed less than five minutes ago remains owned by its processor; a claim older than five minutes is recovered once and reaches `PROCESSED` or bounded terminal `FAILED`.
- Test self/cross-workflow chains stop at depth 5, including a no-op action. Test score threshold crossing exactly once per crossing and initial null-score behavior.
- Freeze/inject time for Trial-ending and Task-overdue scanners; verify exact scope, stable schedule keys, one advisory-lock scanner, and duplicate suppression. Workflow scans must not mutate Trial/Subscription/Task source state.
- Verify invalid archived Tag/field/assignee dependencies fail visibly, Workflow version snapshots survive later edits, and archived definitions stop matching.
- Browser/manual-check list, builder, trigger config, condition builder, action ordering, enable/disable, execution history/detail, failure, retry, RTL, narrow widths, keyboard labels/focus, empty/loading/error/success states, and automation-created Task badge. A live platform session is required for authenticated interactions.

## Phase 10 Analytics coverage

- Controller metadata checks all eight CRM-only reports require `crm.read` and customer lifecycle additionally requires `subscriptions.read`.
- PostgreSQL integration exercises overview, ever-reached funnel stages, explicit Deal source attribution, repeated Deal-stage visits and progression, Activity/Task aggregates, masked owner labels, score bands, Workflow retries/Task links, and Subscription trial/paid/current-Plan summaries against isolated fixtures.
- Date-range tests cover `currentQuarter` alongside the shared Analytics presets. Run the focused CRM integration with `CRM_INTEGRATION_DATABASE_URL`; it is skipped without that database configuration.
- Typecheck/build cover the page and API contracts. Manual checks should cover authenticated desktop/mobile RTL layout, URL-backed filter refresh, each independent section's failure/retry state, keyboard/focus behavior, current-vs-event labels, and independently denying the customer section without `subscriptions.read`.
- No frontend component/E2E suite or lint command currently exists. Record authenticated visual verification only when an authorized platform session is available.

Use the lightest focused tests while iterating, then the API suite, workspace typecheck/build, applied migration checks, and live route checks appropriate to the changed phase. No lint command exists today. Manual authenticated CRM interactions and responsive browser checks require an available platform session; record when that session is unavailable rather than claiming the flow was visually verified.
