# Repository conventions

## Code

- Node.js 22+, TypeScript 5.9 strict mode, npm workspaces.
- PascalCase classes/types; camelCase functions/values; kebab-case source filenames; snake_case database identifiers; uppercase database enum values.
- Keep modules domain-oriented. Controllers handle transport/auth metadata, services own use cases, entities map persistence, DTOs validate trust boundaries, and pure rules live in small tested utilities.
- Reuse existing patterns before adding abstractions. Prefer platform/stdlib and installed dependencies; do not add dependencies for a few maintainable lines.
- Avoid unrelated refactors and preserve user changes.

## API and data

- REST routes live under `/api/v1/{public|auth|tenant|platform}`.
- Validate every external body/query with DTOs and `class-validator`; reject unexpected fields.
- Use Nest exceptions and stable HTTP semantics; do not reveal sensitive/cross-tenant existence.
- Scope tenant queries by resolved `coffeeShopId`, and client-owned queries by both cafe and client.
- Use transactions and explicit locks/rechecks for multi-row, capacity, idempotency, and money paths.
- Schema changes require TypeORM migrations. Never enable `synchronize`.
- Money is integer toman; dates are ISO/Gregorian in API/storage and Jalali only at the UI boundary.

## Security and privacy

- Never bypass hostname tenant resolution, permission guards, client ownership, subscription features, server-side pricing, or gateway verification.
- Frontend hiding is not security.
- Never log or publish full customer phone, OTP, token, cookie, PII ciphertext, request body, or secret.
- Use environment variable names in documentation; never values.
- Preserve public/client response projections unless a task explicitly reviews the PII contract.

## Frontend

- Persian-first RTL, mobile-first, labeled/focusable controls, responsive layouts, and reduced-motion support are baseline requirements.
- Prefer SSR for public content and the same-origin proxy for browser mutations.
- Preserve the curated tenant design boundary and existing session/OTP/UI patterns.

## Testing and changes

- Trace all callers before fixing shared logic; fix the root once and leave the smallest runnable regression check.
- Run relevant tests, typecheck/build, migration checks, and live Docker/API/UI checks in proportion to risk.
- There is no lint script; never claim lint passed.
- Preserve backward compatibility unless the task explicitly changes a contract. Record material architecture/product choices in [DECISIONS.md](DECISIONS.md) and current blockers/debt in [CURRENT_STATE.md](CURRENT_STATE.md).

