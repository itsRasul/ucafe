# Development

## Prerequisites

- Node.js 22+ and npm
- Docker Desktop using Linux containers
- a local `.env.development` containing development-only values for the names used by `compose.yaml` and the API schema; never commit it

The primary supported workflow is Docker Compose with the base and development overlays.

## First build

```powershell
docker compose `
  --env-file .env.development `
  -f compose.yaml `
  -f compose.dev.yaml `
  up --build
```

The API development target runs `nest start --watch`. The web development target runs `next dev --webpack --hostname 0.0.0.0`.

## Subsequent starts

```powershell
docker compose `
  --env-file .env.development `
  -f compose.yaml `
  -f compose.dev.yaml `
  up
```

Source is bind-mounted at `/ucafe`, so ordinary TypeScript/CSS changes are picked up by the dev servers. Named volumes preserve container-native root/API `node_modules` and web `.next` output rather than overlaying them with host paths.

Use `--build` after changing a Dockerfile, package manifests/lockfile, build arguments, or dependencies; it is not required for normal bind-mounted source edits. Recreate a service when environment or Compose configuration changes.

## Local ports

All published development ports bind to loopback:

| Service | URL/port |
| --- | --- |
| Web | `http://localhost:3000` |
| API | `http://localhost:3001/api/v1` |
| PostgreSQL | `localhost:5432` |
| Redis | `localhost:6379` |
| MinIO API | `http://localhost:9000` |
| MinIO console | `http://localhost:9001` |

Tenant pages require a hostname such as `<slug>.<PLATFORM_BASE_DOMAIN>` resolving to loopback. Repository defaults/examples use the `u-cafe.localhost` form.

## Environment contract

The API validates database, Redis, platform domain, JWT/pepper/encryption/proxy secrets, S3, SMS, and payment settings. Development may select `SMS_PROVIDER=development` and `PAYMENT_PROVIDER=simulated`; production may not.

Compose maps MinIO root credentials to API `S3_ACCESS_KEY`/`S3_SECRET_KEY`. The web additionally needs `API_INTERNAL_URL` (normally the internal `/api/v1` address), `PLATFORM_BASE_DOMAIN`, and the same `INTERNAL_PROXY_SECRET` as the API. `API_INTERNAL_URL` is currently missing from `.env.example`; keep it in `.env.development` until that example is corrected.

## Useful commands

```powershell
npm install
npm run dev:api
npm run dev:web
npm run dev:worker
npm run typecheck
npm run build
npm test
npm run migration:show --workspace=@ucafe/api
npm run migration:run --workspace=@ucafe/api
npm run migration:revert --workspace=@ucafe/api
npm run tenant:provision --workspace=@ucafe/api -- "Cafe name" "cafe-slug"
npm run platform:bootstrap --workspace=@ucafe/api -- "<iranian-mobile>"
```

Direct host dev commands remain available for focused work when host dependencies and `.env` are configured, but Compose is the documented integrated workflow. There is no lint command.

## Database changes

TypeORM synchronization is disabled. Add a forward migration, keep entities and both entity-registration lists aligned, start PostgreSQL, run/show migrations, and verify affected behavior. Do not use `migration:revert` as an improvised production rollback.

## Health and shutdown

- API liveness: `/api/v1/health`
- API dependency readiness: `/api/v1/health/ready` (PostgreSQL, Redis, object bucket)
- Web liveness: `/health`

Stop the foreground Compose process with Ctrl+C. Add `-d` for detached operation and use the same two files plus env file for subsequent `ps`, `logs`, `exec`, or `down` commands.
