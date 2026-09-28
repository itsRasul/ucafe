# Tenant CRM UX

## Placement

Tenant CRM belongs inside the Persian-first RTL Tenant Admin panel. The Phase 1 directory lives at `/admin/crm`. It must not appear in `/platform`, which is for platform operators and Platform CRM.

## Existing customer UX

There is no /admin/clients page today. Customer lookup currently appears while managing manual customer segments under Promotions. Phase 1 adds a CRM directory rather than a duplicate customer CRUD surface. Keep manual segment management reachable in its current Promotions context; do not move or gate it in Phase 0.

## Navigation and feature state

The CRM sidebar/bottom-navigation entry is shown only when the user has `tenant_crm.read` and the tenant access projection reports `tenant_crm: true`. The directory and detail pages also show permission or subscription states on direct navigation; API authorization remains authoritative.

## Directory expectations

Use the existing admin shell and Persian RTL, mobile-first, keyboard-accessible patterns. Search is debounced and pagination, status filter, and allowlisted sorting are server-side. Mask phone in list rows and show it only on tenant-authorized Client detail. The read-only Customer 360 detail keeps the existing identity header and adds a compact summary, bounded Recent Orders and Recent Reservations, and a separately paginated Timeline with retry/load-more behavior. Clearly label Known UCafe Spend as delivered UCafe payable value, not confirmed cash or all-café spending. Explain that Timeline reconstructs creation/latest-status facts and cannot show earlier transitions. Empty and error states are independent for overview and Timeline; the view remains responsive and source-module links appear only with the matching read permission (no dedicated Order/Reservation detail deep link currently exists). Loading, focus, and narrow-width states follow existing admin conventions.

Future customer 360, timeline, notes, smart groups, loyalty, feedback, offers, campaigns, and automation belong under this CRM surface by phase, without duplicate Clients, Promotions, or Analytics ownership.
