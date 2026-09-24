# Current state

**Reviewed:** 2026-09-23 (Asia/Tehran)

## Implemented

- Shared multi-tenant PostgreSQL model, hostname resolution, provisioning, platform/tenant RBAC, and separate cafe-client identities.
- Tenant storefront, curated content/theme/media, menu, cart/checkout, offline pickup/courier ordering, reservations, and client panel.
- Owner admin and platform operations panels, including plan controls, renewal invoices/payment intents, consultation requests, and audit history.
- Trial/prepaid/grace/suspension lifecycle, plan feature gates, simulated and Zarinpal payment adapters.
- Development and sms.ir providers plus an encrypted, deduplicated transactional notification outbox.
- Phase 0 tenant analytics foundation: delivered-order overview, timezone-aware periods, previous-period comparison, tenant `analytics.read` permission, and an outcome-time order index. See [ANALYTICS.md](ANALYTICS.md).
- Phase 1 adds configurable Analytics plan entitlement (Golden default), zero-filled revenue/order/AOV trends, and a responsive tenant-admin overview. See [ANALYTICS.md](ANALYTICS.md).
- Phase 2 adds tenant-local hourly and weekday distributions, a weekly and calendar heatmap, and period-specific peaks. See [ANALYTICS.md](ANALYTICS.md).
- Phase 3 adds historical line-based product/category rankings, contribution, growth/decline, zero-sale products, category-at-sale snapshots, and product/category trends. See [ANALYTICS.md](ANALYTICS.md).
- Inventory Phase 1 adds tenant-scoped item/category/location management, transactional opening balances and adjustments, stock/count/history views, and the configurable feature gate. See [INVENTORY.md](INVENTORY.md) and [PROGRESS.md](PROGRESS.md).
- PostgreSQL/Redis/MinIO readiness, security headers, request IDs, backup/restore scripts, Docker development/production targets.

## Production blockers

- Successful real sms.ir acceptance for every configured template ID.
- Successful low-value Zarinpal request, redirect, callback, verification, and reconciliation acceptance with a real merchant.
- Final hosting topology, wildcard DNS/TLS, reverse-proxy header stripping/trust, secret management, monitoring/on-call destinations, backup retention, and vulnerability review.

The software is not production-ready until [LAUNCH_CHECKLIST.md](LAUNCH_CHECKLIST.md) is complete.

## Known technical debt

- Notifications are dispatched by an in-process five-second API timer. Conditional row claims prevent duplicate sends, but multiple API replicas duplicate scans/scheduled sweeps and have no dedicated worker coordination.
- The worker workspace is only a bootstrap scaffold; media processing and notification scheduling still run in the API.
- Redis is required and probed by readiness but is not currently used for OTP throttling or application caching.
- Image processing is synchronous; object-store failures can leave orphan variants without automated reconciliation.
- Reservation/business API errors are primarily English while the user interface is Persian.
- Reservation/opening-hour logic supports same-day ranges only.
- `compose.prod.yaml` publishes API and PostgreSQL loopback ports; a real deployment must deliberately restrict/reroute them.
- `.env.example` omits `API_INTERNAL_URL`, although Compose requires it for web-to-API SSR/proxy calls.
- The environment key `SUBSCRIPTION_FAILD_PAID` contains a compatibility typo and must be configured exactly as implemented until a migration strategy renames it.
- `README.md` still routes readers to removed phase/progress documents and must be updated in a separately authorized change.

## Immediate next work

1. Begin Phase 4 customer analytics from cafe-scoped client identity and delivered orders; keep [ANALYTICS.md](ANALYTICS.md) authoritative.
2. Complete provider and hosting acceptance without adding unrelated product scope.
3. Move the dispatcher to a coordinated worker before horizontal API scaling.
