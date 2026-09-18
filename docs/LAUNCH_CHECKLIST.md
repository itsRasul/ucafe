# Production launch checklist

Implemented software capability and external acceptance are deliberately separate. A checked implementation item does not waive an unchecked provider/hosting gate.

## Repository gates

- [ ] full `npm test` passes (currently 66/67; stale client-panel test constructor)
- [ ] `npm run typecheck` passes for all workspaces
- [ ] `npm run build` passes for API, web, and worker
- [ ] all migrations applied; `synchronize` remains disabled
- [ ] `/api/v1/health/ready` verifies PostgreSQL, Redis, and the private object bucket
- [ ] smoke checks pass for platform and tenant hosts, security headers, and HTML budget
- [ ] wrong-tenant IDs, forged internal headers, permission boundaries, and client ownership are rechecked
- [ ] duplicate order checkout/payment callback and reservation-capacity race behavior are verified
- [ ] backup restores into a disposable database and matching object snapshot/restore procedure is tested
- [ ] production configuration refuses simulators and non-HTTPS callback

## Real providers

- [ ] every sms.ir template has an approved numeric ID and exact parameter names
- [ ] real admin/client OTP delivery accepted without secret/OTP logging
- [ ] real order, reservation, reminder, subscription, payment, and consultation messages accepted
- [ ] retry/error behavior observed for an sms.ir failure
- [ ] real low-value Zarinpal request, redirect, callback, verification, duplicate callback, and result redirect accepted
- [ ] settlement/reconciliation and merchant/legal ownership approved

## Hosting and security

- [ ] final host/topology and resource limits documented
- [ ] wildcard/base DNS and valid TLS/HSTS verified
- [ ] reverse proxy preserves host/trusted forwarding and strips both internal ucafe headers
- [ ] API/data/Redis/object store are not unintentionally public
- [ ] production secrets stored and rotation owners assigned
- [ ] dependency/container vulnerability scans reviewed
- [ ] centralized logs/metrics/alerts and on-call destinations tested
- [ ] managed database/object backups, encryption, off-host retention, and restore schedule assigned
- [ ] privacy terms, data retention/deletion, incident contacts, and operational ownership approved

## UX and performance

- [ ] tenant SSR HTML ≤ 250 KiB and production p95 target approved/measured
- [ ] no horizontal overflow at 390 px and 1440 px on critical routes
- [ ] language/direction, unique main heading, labels, keyboard focus, touch targets, and reduced-motion verified
- [ ] media uses generated variants with stable dimensions; original uploads remain private/discarded
- [ ] target mobile browsers accept Jalali input and OTP/cart/checkout/panel flows

ucafe is not production-ready while any required item remains unchecked.

