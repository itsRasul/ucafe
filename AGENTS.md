# ucafe agent guide

## Read by task

Read only the documents relevant to the current change; do not load the entire set by default.

| Topic | Document |
| --- | --- |
| Support Ticketing architecture | `docs/TICKETING.md` |
| Current product requirements | `docs/PRD.md` |
| System shape and boundaries | `docs/ARCHITECTURE.md` |
| Cross-domain behavior | `docs/BUSINESS_RULES.md` |
| Tenant security | `docs/MULTI_TENANCY.md` |
| Backend patterns | `docs/BACKEND.md` |
| Frontend patterns | `docs/FRONTEND.md` |
| Persistence | `docs/DATABASE.md` |
| Authentication / authorization | `docs/AUTHENTICATION.md`, `docs/AUTHORIZATION.md` |
| Subscriptions / ordering / reservations | `docs/SUBSCRIPTIONS.md`, `docs/ORDERING.md`, `docs/RESERVATIONS.md` |
| Notifications / payments | `docs/NOTIFICATIONS.md`, `docs/PAYMENTS.md` |
| Local workflow / verification | `docs/DEVELOPMENT.md`, `docs/TESTING.md` |
| Production | `docs/OPERATIONS.md`, `docs/LAUNCH_CHECKLIST.md` |
| Code/change rules | `docs/CONVENTIONS.md` |
| Current blockers/debt | `docs/CURRENT_STATE.md` |
| Historical reasoning | `docs/DECISIONS.md` |
| Platform CRM foundation | `docs/crm/README.md` and its linked topic documents |
| Tenant CRM foundation | `docs/tenant-crm/README.md` and its linked topic documents |

For feature work, read `PRD.md`, `BUSINESS_RULES.md`, and the relevant domain/technical document. Inspect the actual implementation, migrations, tests, Git status, and current Docker state before editing. If documentation and code disagree, investigate; code/config/migrations describe implementation while the PRD describes current product intent.

Before changing Platform CRM, read `docs/crm/README.md`, `docs/crm/DOMAIN_MODEL.md`, `docs/crm/LIFECYCLE.md`, `docs/crm/INTEGRATIONS.md`, and `docs/crm/EVENTS.md`, then the CRM topic and existing domain documents relevant to the change. Platform CRM Phases 0–10 are implemented; keep its documentation updated whenever behavior, lifecycle, API contracts, permissions, integrations, or architecture changes.

Before changing Tenant CRM, read docs/tenant-crm/README.md, docs/tenant-crm/DOMAIN_MODEL.md, docs/tenant-crm/MULTI_TENANCY.md, docs/tenant-crm/IDENTITY.md, docs/tenant-crm/INTEGRATIONS.md, and the feature-specific Tenant CRM document. For Customer 360/Timeline semantics also read docs/tenant-crm/ANALYTICS.md and docs/tenant-crm/EVENTS.md, and verify the current Orders/Reservations source lifecycle before changing cross-domain behavior. Tenant CRM architecture, lifecycle, identity, integration, permission, and tenant-isolation changes must update relevant documentation in the same change. Phases 1–2 implement a read-only Client directory and Customer 360; later phases remain planned.

## Repository

- Node.js 22+, TypeScript 5.9, npm workspaces.
- `apps/web`: Next.js 16 / React 19 Persian-first public, client, owner, and platform UI.
- `apps/api`: NestJS 11 / TypeORM 0.3 / PostgreSQL 17 REST API.
- `apps/worker`: NestJS scaffold only; current jobs run in the API.
- Redis 7 is readiness-checked but not used for application caching/rate limits. MinIO/S3 private media storage is active.

## Non-negotiable rules

1. Stay within the user-requested scope; preserve unrelated/user changes.
2. Reuse existing code and dependencies before adding abstractions or packages.
3. Validate external input with DTOs; enforce tenant/client scope in queries and important database constraints/triggers.
4. Never trust tenant identity from arbitrary input, bypass server authorization/features/pricing, expose PII, or log bodies/secrets/tokens/OTPs/full phones.
5. Use transactions and explicit locks/rechecks for multi-row, capacity, payment, and idempotency paths.
6. Schema changes require forward TypeORM migrations; never enable synchronization.
7. Keep secrets in validated environment variables. Development providers must fail closed in production.
8. Public UI remains mobile-first, Persian RTL, accessible, SSR where practical, and reduced-motion safe.
9. Run checks proportional to risk and update current docs/decisions when behavior or architecture materially changes.

## Commands

```powershell
npm install
npm run dev:api
npm run dev:web
npm run typecheck
npm test
npm run build
npm run migration:show --workspace=@ucafe/api
npm run migration:run --workspace=@ucafe/api
docker compose --env-file .env.development -f compose.yaml -f compose.dev.yaml up --build
```

There is no lint command; do not claim lint passed. A change is complete only when its requested behavior, migrations where needed, relevant automated checks, and live integration/UI checks pass with no new known regression.

