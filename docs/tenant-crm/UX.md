# Tenant CRM UX

## Placement

Tenant CRM belongs inside the Persian-first RTL Tenant Admin panel. The Phase 1 directory lives at `/admin/crm`. It must not appear in `/platform`, which is for platform operators and Platform CRM.

## Existing customer UX

There is no /admin/clients page today. Customer lookup currently appears while managing manual customer segments under Promotions. Phase 1 adds a CRM directory rather than a duplicate customer CRUD surface. Keep manual segment management reachable in its current Promotions context; do not move or gate it in Phase 0.

## Navigation and feature state

The CRM sidebar/bottom-navigation entry is shown only when the user has `tenant_crm.read` and the tenant access projection reports `tenant_crm: true`. The directory and detail pages also show permission or subscription states on direct navigation; API authorization remains authoritative.

## Directory expectations

**Phase 3 Customer 360.**

Customer 360 adds independent sections for explicit preferences, tags, custom fields, internal notes, and reminders. Operators with `tenant_crm.manage` can edit; read-only users see data without mutation controls. Notes have bounded pagination and edit/archive actions. Reminder date entry uses the device's local datetime control and display/filtering uses the café time zone. Tenant-wide reminders provide Today, Overdue, Upcoming, Completed, Canceled, and All views; custom fields and tenant tags are managed from the CRM admin screen. Empty, loading, error, and success states are shown in the Persian RTL layout.

Use the existing admin shell and Persian RTL, mobile-first, keyboard-accessible patterns. Search is debounced and pagination, status filter, and allowlisted sorting are server-side. Mask phone in list rows and show it only on tenant-authorized Client detail. The read-only Customer 360 detail keeps the existing identity header and adds a compact summary, bounded Recent Orders and Recent Reservations, and a separately paginated Timeline with retry/load-more behavior. Clearly label Known UCafe Spend as delivered UCafe payable value, not confirmed cash or all-café spending. Explain that Timeline reconstructs creation/latest-status facts and cannot show earlier transitions. Empty and error states are independent for overview and Timeline; the view remains responsive and source-module links appear only with the matching read permission (no dedicated Order/Reservation detail deep link currently exists). Loading, focus, and narrow-width states follow existing admin conventions.

Customer 360, Timeline, Notes, Smart Groups, Segments, Loyalty, and Feedback belong under this CRM surface. Future Offers, Campaigns, and Automation belong here by phase without duplicating Clients, Promotions, or Analytics ownership.

## Phase 4 Segments and Smart Groups

The saved Segment workspace is at /admin/crm/segments; fixed Smart Groups are at /admin/crm/smart-groups. Both are linked from CRM navigation. The criteria editor reads the server's field and option catalog, presents nested AND/OR groups, and uses native text, number, date, select, and boolean controls. Operators and inputs change with field type. Users can preview a count and a short sample, then open a separately paginated member list.

The UI states that membership is recalculated from current café data. Smart Group cards show their exact definitions and can open members or start a saved Segment copied from that preset. Segment list rows show active status and invalid archived criteria; invalid references remain visible so a manager can repair the definition. Empty, loading, permission, entitlement, error, and success states have Persian copy. Mutation controls require tenant_crm.manage; the API independently enforces permission and feature access.

The page is Persian RTL and responsive with labeled controls, keyboard-visible focus, native form validation, and mobile-width layouts. Authenticated desktop/mobile visual acceptance remains pending until a tenant-admin session and running app are available.

## Phase 5 Loyalty

The manager workspace is `/admin/crm/loyalty`, linked from the CRM directory. It edits the spend-per-point threshold and program state, then creates, edits, activates, and deactivates tenant Rewards. Customer 360 shows the derived balance, active reward costs/eligibility, recent redemptions, and recent Ledger activity with a bounded older-history action. Managers can record reasoned credits/debits and staff redemption; native confirmation precedes redemption. Blocked Clients can still be reviewed but point-changing controls are unavailable. Loading, errors, empty program/catalog/history, busy actions, and success feedback use the existing Persian RTL CRM styles and native form validation.

No customer-facing reward claim, checkout integration, coupon generation, or automatic fulfillment is implied; the staff action records that the café fulfilled a Reward.

## Phase 6 Feedback

The tenant workspace is `/admin/crm/feedback`, linked from CRM navigation and Client 360. It provides a paginated operational inbox with search and status/rating/source/date filters, a manager-only manual-entry form, and a focused detail/recovery view. Detail supports mark-for-attention, an optional internal resolution note, and creation of a normal Phase 3 Reminder. Customer 360 shows per-Client rating summary and the latest five comments; Timeline uses localized Feedback event labels without exposing comment bodies.

Authenticated Clients can submit a 1–5 rating and optional comment from their own delivered Order or completed Reservation detail. Existing submissions display only their own rating/comment/time. Internal status, resolution note, staff identity, and Reminders stay staff-only. Views use Persian RTL labels, responsive layouts, labeled controls, keyboard-visible focus, busy/error/success states, and touch-friendly controls. Authenticated desktop/mobile visual acceptance remains pending until tenant-admin and customer sessions are available.


## Phase 7 Offers

The CRM navigation links to a Persian RTL Offers workspace for Draft, Active, and Ended records. Managers choose an existing Discount and an active saved Segment, preview its count and masked sample, then save a Draft. Activation explains that it freezes current Segment membership. The client summary distinguishes CRM audience membership, recorded redemptions, and order snapshots with a discount. Existing Discount editing stays in the Promotions workspace.

## Phase 9 Automation

`/admin/crm/automations` is linked from the CRM directory. A guided form selects one supported trigger, optional nested AND/OR conditions from Phase 4 field metadata, and an ordered list of internal Tag, Note, and Reminder actions. Café-local lifecycle triggers offer a count preview. Definition cards expose Draft/Active/Paused/Archived lifecycle actions and expand into paginated execution history with safe errors and ordered action results. Labels, native validation, visible focus, busy/error/success/empty states, and narrow-screen layouts use the existing Persian RTL CRM shell. Communication actions and arbitrary workflow canvases are excluded. Authenticated desktop/mobile acceptance remains pending until a tenant-admin session is available.
