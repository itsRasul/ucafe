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

## Deployment

1. Record verified PostgreSQL and object-storage backup/snapshot identifiers.
2. Build immutable API/web production targets from the reviewed revision; scan images and production dependencies.
3. Run migrations once as a controlled release job. The current API production command also runs migrations at startup, so do not start multiple API replicas concurrently during migration.
4. Start API and require `/api/v1/health/ready` to return 200; start web and require `/health` to return 200.
5. Route traffic only after readiness. Run the smoke script against platform and a tenant host, then provider acceptance.
6. Observe structured request events, error rate/latency, dependency health, notification failures/backlog, and payment verification failures.

The reverse proxy must terminate TLS, redirect HTTP, preserve the external host, set trusted forwarded address/protocol, and strip inbound `x-ucafe-tenant-host` plus `x-ucafe-proxy-secret`. Keep API, PostgreSQL, Redis, and object storage private except for the deliberately routed gateway callback/API paths. Review `compose.prod.yaml` loopback publications rather than treating it as a complete production perimeter.

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

- API/web readiness and repeated restart failures
- PostgreSQL/Redis/object-store health and capacity
- HTTP 5xx/error rate and p95 latency
- notification pending age, retry exhaustion, provider failures
- payment verification failures/stale `VERIFYING` intents
- backup/restore verification age and certificate expiry

