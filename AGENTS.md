# ucafe execution rules

Read `docs/PROJECT_SPEC.md`, `docs/ARCHITECTURE.md`, `docs/PLAN.md`, `docs/PROGRESS.md`, and `docs/DECISIONS.md` before changing code. `docs/PROGRESS.md` is the continuation checkpoint.

## Stack and repository

- Node.js 22+, TypeScript 5.9, npm workspaces.
- `apps/web`: Next.js 16 / React 19, Persian-first public and admin UI.
- `apps/api`: NestJS 11, TypeORM 0.3, PostgreSQL 17 REST API.
- `apps/worker`: NestJS worker scaffold; background processing is not implemented.
- Redis 7 is available for ephemeral/rate-limit data. MinIO-compatible storage is planned but not active.
- Shared configuration belongs under `packages/`; product and architecture details belong under `docs/`.

## Mandatory workflow

1. Work on exactly the phase named by the user. Do not add adjacent features or refactor outside its scope.
2. Inspect the existing implementation, migrations, tests, `git status`, and current Docker state before editing.
3. Preserve unrelated/user changes. Never use destructive Git or filesystem commands without explicit authorization.
4. Use TypeORM migrations for every schema change; synchronization stays disabled.
5. Validate all external input with DTOs and `class-validator`; enforce tenant scope in queries and, where important, database constraints/triggers.
6. Use Nest exceptions and stable HTTP status codes. Public errors must not reveal sensitive data, tenant existence beyond intended hostname behavior, OTPs, or internals.
7. Keep secrets in environment variables validated by the configuration schema. Never commit real credentials, phone numbers, OTPs, or `.env` contents.
8. Use structured Nest logging. Development OTP logging is allowed only through the development SMS provider and must fail closed in production.
9. At phase end, run relevant checks, update `docs/PROGRESS.md`, and append material decisions to `docs/DECISIONS.md`.

## Code standards

- Strict TypeScript; descriptive PascalCase classes/types, camelCase values/functions, kebab-case filenames, snake_case database names, uppercase enum database values.
- Keep modules domain-oriented. Controllers handle transport/auth metadata; services own use cases; entities describe persistence; pure rules belong in utilities with tests.
- Public UI is mobile-first, RTL/Persian-first, accessible, server-rendered where practical, and must respect `prefers-reduced-motion`.
- Do not expose customer phone numbers in public or reservation responses. Do not log sensitive request bodies.
- Prefer atomic transactions for multi-row changes and explicit locking/rechecks for capacity or payment races.

## Commands

```bash
npm install
npm run dev:api
npm run dev:web
npm run build
npm run typecheck
npm test
npm run migration:show --workspace=@ucafe/api
npm run migration:run --workspace=@ucafe/api
docker compose up -d --build
docker compose ps
```

There is currently no lint command; do not claim lint passed. Test the relevant live API/UI in Docker when a phase changes integration behavior.

## Definition of Done

A phase is Done only when its stated scope and acceptance criteria in `docs/PLAN.md` are satisfied; required migrations are applied; relevant type-checks, tests, builds, and live checks pass; no new known regression remains; `docs/PROGRESS.md` reflects reality; and material decisions are logged. Partial implementation or compilation alone is not Done.
