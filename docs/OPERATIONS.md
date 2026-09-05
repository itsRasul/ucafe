# Cafexa launch and operations runbook

## Release gate

Production deployment is blocked until all values marked `required` below exist in the secret manager and both real providers pass acceptance tests. Never copy `.env` into an image or commit it.

- `NODE_ENV=production`
- unique 32+ character `ACCESS_TOKEN_SECRET`, `AUTH_PEPPER` and `INTERNAL_PROXY_SECRET`
- random 32-byte base64 `PII_ENCRYPTION_KEY`
- managed PostgreSQL/Redis endpoints with authentication, TLS where offered and automated retention
- private S3-compatible bucket credentials
- `SMS_PROVIDER=kavenegar`, API key and approved OTP/reservation templates
- `PAYMENT_PROVIDER=zarinpal`, merchant ID and public HTTPS callback base
- trusted reverse-proxy hop count, wildcard DNS and valid TLS certificate for the platform domain

The API configuration intentionally refuses to boot in production with either simulator or an HTTP payment callback.

## Deployment

1. Back up PostgreSQL and object storage; record the backup identifiers.
2. Build immutable API/web images from the reviewed revision and scan them and their dependencies.
3. Run the migration image as a single release job. Do not run multiple migration jobs concurrently.
4. Start API, then require `/api/v1/health/ready` to return 200 before routing traffic. Start web and require `/health` to return 200.
5. Run `scripts/smoke.ps1` against the deployment hostname, then verify OTP, reservation confirmation and a low-value Zarinpal acceptance settlement.
6. Watch structured `http_request` events, error rate, p95 latency, dependency health, notification retry exhaustion and payment verification failures.

The reverse proxy must terminate TLS, redirect HTTP to HTTPS, preserve the external `Host`, set `X-Forwarded-For`/`Proto`, remove inbound `X-Cafexa-Tenant-Host` and `X-Cafexa-Proxy-Secret`, and expose only web plus the Zarinpal callback. The web service and API share `INTERNAL_PROXY_SECRET` over a private network; the API must not be publicly reachable except for explicitly routed public endpoints.

## Backup and restore

Run `./scripts/backup.ps1` from the repository. Encrypt completed backups, copy them off-host and retain daily/weekly/monthly sets according to the hosting policy. S3/MinIO versioning or a provider snapshot is required in addition to PostgreSQL backups.

Test a database dump without touching Cafexa data:

```powershell
$backup = ./scripts/backup.ps1
./scripts/verify-restore.ps1 -BackupFile $backup
```

For a real recovery, stop writes, provision a clean PostgreSQL database, restore with `pg_restore --exit-on-error`, point one isolated API instance at it, run `migration:show`, check tenant counts and media metadata, then switch traffic only after application smoke checks. Keep the old database read-only until the recovery is accepted.

## Rollback and incidents

Application images may roll back only when the deployed schema is backward-compatible. A failed destructive migration requires restoring the pre-release backup into a new database; never improvise `migration:revert` in production. Revoke exposed provider/database/object-storage credentials, rotate auth secrets if implicated, preserve redacted logs and audit events, and document scope/timeline. Rotating `PII_ENCRYPTION_KEY` requires a separately reviewed data migration.

## Minimum alerts

- readiness failure for two consecutive minutes
- API 5xx rate above 2% for five minutes
- p95 API latency above 750 ms for ten minutes
- PostgreSQL storage/connection saturation, Redis unavailability or object-store errors
- notification deliveries exhausted or payment verification errors
- certificate expiry under 21 days and backup/restore verification older than 30 days
