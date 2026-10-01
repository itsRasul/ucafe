# Operations

## Capability versus acceptance

The repository contains production-mode API/web images, migrations, readiness checks, backup/restore scripts, sms.ir and Zarinpal adapters, security headers, and request metadata logging. This does not prove production readiness. Real provider, host, DNS/TLS, proxy, monitoring, retention, and incident ownership acceptance remain external gates in [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md).

## Required production configuration

Store values in a secret manager; never bake `.env` into an image. At minimum:

- `NODE_ENV=production`
- unique high-entropy `ACCESS_TOKEN_SECRET`, `AUTH_PEPPER`, `INTERNAL_PROXY_SECRET`; random 32-byte base64 `PII_ENCRYPTION_KEY`
- authenticated/TLS-capable `DATABASE_URL` and `REDIS_URL` where offered
- private S3 endpoint/region/bucket/access credentials
- `SMS_PROVIDER=smsir`, `SMSIR_API_KEY`, numeric `SMSIR_OTP_TEMPLATE_ID`, and every transactional template ID used by the app
- `PAYMENT_PROVIDER=zarinpal`, GUID `ZARINPAL_MERCHANT_ID`, public HTTPS `PAYMENT_CALLBACK_BASE_URL`
- `PLATFORM_BASE_DOMAIN`, platform names, trusted proxy hop count, and web `API_INTERNAL_URL`

The schema refuses development SMS, simulated payment, or an HTTP payment callback in production.

Ticketing also requires the three `SUPPORT_TICKET_*` numeric sms.ir template IDs with the configured named parameters. Its API accepts up to five 8 MiB files; set the production reverse-proxy/body limit to at least 40 MiB plus multipart overhead. The private S3 credentials need list and delete access under `tenants/*/support-tickets/` for orphan cleanup. Object storage is checked at API startup and readiness, so an unavailable bucket can prevent startup or traffic routing. The 10-minute API scheduler logs bounded inactivity and orphan cleanup counts; repeated failures should alert through the API error/log pipeline.

## Deployment

1. Record verified PostgreSQL and object-storage backup/snapshot identifiers.
2. Build immutable API/web production targets from the reviewed revision; scan images and production dependencies.
3. Run migrations once as a controlled release job. The current API production command also runs migrations at startup, so do not start multiple API replicas concurrently during migration.
4. Start API and require `/api/v1/health/ready` to return 200; start web and require `/health` to return 200.
5. Route traffic only after readiness. Run the smoke script against platform and a tenant host, then provider acceptance.
6. Observe request-metadata logs, error rate/latency, dependency health, notification failures/backlog, and payment verification failures.

The reverse proxy must terminate TLS, redirect HTTP, preserve the external host, set trusted forwarded address/protocol, and strip inbound `x-ucafe-tenant-host` plus `x-ucafe-proxy-secret`. Keep API, PostgreSQL, Redis, and object storage private except for the deliberately routed gateway callback/API paths. Review `compose.prod.yaml` loopback publications rather than treating it as a complete production perimeter.

## Sentry alerts and uptime

Set `SENTRY_TRACES_SAMPLE_RATE=0.05` for production unless quota/latency review supports another value; development defaults to 1 and tests to 0. Missing DSNs disable the relevant SDK. Set the Sentry environment to `production` so development events cannot match production alert rules.

In each existing `ucafe-api` and `ucafe-web` Sentry project, add one first-seen/actionable error alert filtered to `environment:production` and route it to the team's existing notification destination. API expected 4xx errors are excluded by the capture boundary. Add at most one production error-count/spike rule after confirming account support and a traffic baseline; set its threshold from that baseline. Add latency rules only after a useful baseline exists; do not guess a threshold.

Create one public HTTPS uptime check for `GET https://<web-origin>/health` and one for `GET https://<api-origin>/api/v1/health`, expecting HTTP 200, and route failures to the same existing notification destination. These are liveness checks; keep dependency readiness at `/api/v1/health/ready` for deployment and on-call diagnostics so a dependency outage does not look like the API process itself is down. Do not create tenant-specific checks. Replace the placeholders with the deployed public HTTPS origins; they and the account's notification destination are not stored in this repository.

When an alert fires, check the Sentry environment/release, the sampled trace if present, API request ID, safe tenant context, and matching application readiness/restart/provider logs. Sentry telemetry is best-effort and must never be made a request or business-operation dependency. See [observability](OBSERVABILITY.md) for propagation and privacy limits.

## Backup and restore

`scripts/backup.ps1` creates a PostgreSQL custom-format dump inside the repository. Encrypt and copy completed backups off-host; assign daily/weekly/monthly retention. Configure independent S3/MinIO versioning or provider snapshots because the database dump does not contain object bytes.

```powershell
$backup = ./scripts/backup.ps1
./scripts/verify-restore.ps1 -BackupFile $backup
```

The verifier restores to a uniquely named disposable database, checks migration history, and removes the temporary database/file. Run it at least monthly and after backup-process changes.

For real recovery, stop writes, restore into a clean database with `pg_restore --exit-on-error`, point an isolated API at it, inspect migration/entity counts and media metadata, run smoke/business checks, then switch traffic. Keep the old database read-only until acceptance.

## Rollback and incidents

Roll back application images only while the deployed schema is backward-compatible. A failed destructive migration normally requires restoring the pre-release backup into a new database; do not improvise a production `migration:revert`.

Revoke exposed provider/data/object credentials, rotate auth secrets if implicated, preserve redacted logs and audit records, document scope/timeline, and notify owners under the approved incident policy. Rotating `PII_ENCRYPTION_KEY` requires an explicit re-encryption migration because existing encrypted OTP/outbox values depend on it.

## Minimum alerts

The Sentry project boundary, privacy rules, runtime configuration, and source-map build secret are in [OBSERVABILITY.md](OBSERVABILITY.md). Remote project and event delivery still require account-side validation.

- API/web readiness and repeated restart failures
- PostgreSQL/Redis/object-store health and capacity
- HTTP 5xx/error rate and p95 latency
- notification pending age, retry exhaustion, provider failures
- Ticket inactivity/orphan sweep errors, repeated storage cleanup failures, and ticket notification retry exhaustion; alert using counts/error categories only, never message or provider payloads
- CRM Workflow outbox age/backlog, terminal execution failures, and loop-depth blocks through database monitoring; inspect counts and timestamps only, never event payloads
- payment verification failures/stale `VERIFYING` intents
- backup/restore verification age and certificate expiry

