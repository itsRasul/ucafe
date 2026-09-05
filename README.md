# Cafexa (کافکسا)

Cafexa is a multi-tenant SaaS platform for premium coffee-shop websites.

## Status

The MVP feature set through Phase 12 is implemented. Phase 13 local launch hardening is complete; production release remains blocked on real Kavenegar/Zarinpal credentials and the selected hosting/DNS/TLS/monitoring environment. See `docs/PROGRESS.md` and `docs/LAUNCH_CHECKLIST.md`.

## Applications

- `apps/web`: Next.js public website and administration interfaces
- `apps/api`: NestJS REST API
- `apps/worker`: background jobs

## Local infrastructure

- PostgreSQL
- Redis
- MinIO-compatible object storage
