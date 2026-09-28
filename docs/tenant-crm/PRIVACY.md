# Tenant CRM privacy

## Current behavior

Client stores name, E.164 phone, status, and authentication timestamps. OTP and notification paths protect secrets and phone values according to the existing authentication/notification implementation. The authenticated Client can see their own phone; the Tenant CRM list masks it, and tenant-authorized CRM detail exposes it to staff. Phase 2 Order/Reservation projections are deliberately limited to fields needed for customer service; they omit addresses, line items, private notes, and staff actor identifiers. Phase 3 Notes and preferences are tenant-admin-only and Timeline metadata is minimized; neither is sourced from logs or notification payloads. There is no Client email, marketing consent, export, deletion, anonymization, or retention workflow.

Client addresses are soft deleted. Current Orders and Reservations restrict deleting a referenced Client. Café suspension preserves tenant data. Platform audit is for platform operations and is not a tenant CRM audit log.

## Future requirements

- Keep customer data tenant isolated and expose only fields needed for the current staff workflow.
- Treat internal notes, allergies, birthdays, preferences, and purchase history as sensitive. Define who may read each category before adding it.
- Never infer marketing permission from a phone number, account, order, or reservation. Any future marketing channel requires an explicit opt-in/opt-out model with source and time, subject to product/legal review.
- Design deletion, archive, anonymization, retention, and export with Orders/Reservations owners before implementation; preserve source records and their operational integrity.
- Keep logs, audit summaries, event envelopes, and campaign job errors free of full phone, message content, free-text notes, OTPs, and secrets.
- Scope exports and bulk operations to the resolved café and audit consequential actions without duplicating customer PII.

## Open product/legal decisions

**Phase 3 handling.**

CRM records are private to the owning café and authorized tenant users. Notes are internal and excluded from Client APIs and Timeline bodies. Dietary and allergy notes are free-form staff-entered operational context; UCafe does not infer or interpret medical information from Orders. Birthday stores month/day only. Custom field values and reminders are not shared with Platform CRM. Existing Client deletion cascades its CRM-owned records. Reminder assignees and note authors are projected with masked labels, not full phone numbers.

Retention periods, deletion rights, consent wording/evidence, sensitive-field policy, and export format have not been established here. Record a decision with the product/legal owner before implementing the related behavior. This document does not invent legal policy.
