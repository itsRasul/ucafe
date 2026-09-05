# ucafe MVP launch checklist

## Automated gates

- [x] strict type checks, unit tests and production builds
- [x] all migrations applied with synchronization disabled
- [x] live PostgreSQL/Redis/object-storage readiness endpoint
- [x] tenant SSR/API/web health smoke test and security-header assertions
- [x] PostgreSQL backup restored and validated in a disposable database
- [x] duplicate payment callback does not double-credit
- [x] development simulators are rejected by production configuration
- [x] authenticated internal tenant-host forwarding

## Performance and accessibility budgets

- tenant SSR HTML at most 250 KiB
- warmed local tenant response at most 1,000 ms; production p95 target 750 ms
- no horizontal overflow at 390 px or 1440 px
- page language/direction, unique main heading, labeled controls, keyboard focus and reduced-motion behavior verified
- hero has stable dimensions; gallery images are lazy and optimized; no original uploads are served

## Required manual/external gates

- [ ] real Kavenegar OTP and reservation confirmation acceptance
- [ ] real Zarinpal request, redirect, verified callback and reconciliation acceptance
- [ ] production hostname, wildcard DNS, TLS and reverse-proxy header stripping verified
- [ ] managed backup retention, monitoring destinations and on-call contacts assigned
- [ ] dependency/container vulnerability scan reviewed
- [ ] privacy terms, operational ownership and incident contacts approved

The MVP is not production-ready while any external gate remains unchecked.
