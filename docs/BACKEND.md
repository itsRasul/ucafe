# Backend

## Shape

`apps/api` is a strict TypeScript NestJS 11 REST service using TypeORM 0.3 and PostgreSQL. Modules are organized by domain under `src/<domain>`; shared cross-domain concerns are explicit modules rather than generic repositories.

Use the existing pattern:

- controller: route, DTO/body/query/param parsing, guards, actor/tenant metadata
- service: use case, tenant/ownership query, transactions, side effects, response projection
- entity: persistence mapping and local constraints
- DTO: external input validation with `class-validator`/`class-transformer`
- utility: deterministic rules with one focused Node test

Do not introduce a repository/interface/factory layer unless more than one real implementation needs it. Existing services use injected TypeORM repositories for guards and `DataSource`/`EntityManager` for use cases.

## Request conventions

- Global prefix: `/api/v1`.
- Route families: public tenant/client, shared administrative auth, tenant administration, platform administration, and health.
- Global `ValidationPipe`: `whitelist`, `forbidNonWhitelisted`, and `transform` are enabled.
- Use Nest exceptions and stable status codes. Some feature/suspension errors intentionally return an object with a stable `code`.
- UUID route parameters generally use `ParseUUIDPipe`; keep new resource identifiers equally strict.
- Public errors must not expose internals, secrets, OTPs, or cross-tenant resource existence.

## Data access and transactions

Always scope tenant records with `coffeeShopId` and owned client records with both tenant and client. Raw SQL exists for projections, notification scheduling, locks, and database-specific operations; parameterize values and preserve scope joins.

Use `DataSource.transaction` for multi-row state. Existing concurrency patterns are:

- advisory transaction lock for tenant provisioning-sensitive business keys, order idempotency, subscription/checkout, client phone creation, and branch/date reservation capacity
- pessimistic row lock for order/reservation status and reservation edits
- unique constraints plus conflict-safe inserts for identities, outbox, and idempotency

Do not catch broad database failures unless converting a known constraint code. Notifications deliberately fail open at enqueue so an SMS outage cannot roll back the business write; document any similar choice explicitly.

## Configuration and providers

Joi validates the API environment at boot. Production rejects development SMS, simulated payment, and non-HTTPS callbacks. Add configuration in the schema and example/Compose contract together; never commit values.

Provider abstractions currently have real and development implementations for SMS and payments. Media uses the installed AWS S3 client against S3-compatible storage and Sharp for bounded image conversion.

## Jobs and logging

The notification service owns a five-second in-process dispatcher and one-minute scheduled sweep. The worker workspace is not wired to database/providers. Do not imply a queue exists.

Use Nest structured logging and the request observability middleware. Request logs contain request ID, method, path, status, and duration only. Never log bodies, bearer/cookie values, full phone numbers, OTPs, PII ciphertext, or provider secrets.

## Schema changes

Entities are registered explicitly in both `apps/api/src/database/database.module.ts` and `apps/api/src/database/data-source.ts`. Every schema change requires a forward TypeORM migration; `synchronize` and `migrationsRun` remain false. Update both entity registration sites for new entities and verify migration state against PostgreSQL.

## Response projections

Prefer explicit projections at privacy boundaries. Public/client reservation responses omit phone; client order responses omit administrative client details; tenant admin projections may include operational client phone; platform full-user phone requires protected user-read authority.

## Verification

Run the smallest relevant spec, then workspace typecheck/build and the full API suite for cross-domain changes. Integration behavior also requires migrations and live Docker API/UI checks. See [TESTING.md](TESTING.md).
