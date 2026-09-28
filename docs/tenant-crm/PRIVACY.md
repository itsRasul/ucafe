# Tenant CRM privacy

## Current behavior

Client stores name, E.164 phone, status, and authentication timestamps. OTP and notification paths protect secrets and phone values according to the existing authentication/notification implementation. The authenticated Client can see their own phone; the Tenant CRM list masks it, and tenant-authorized CRM detail exposes it to staff. There is no Client email, marketing consent, CRM note, preferences, export, deletion, anonymization, or retention workflow.

Client addresses are soft deleted. Current Orders and Reservations restrict deleting a referenced Client. Café suspension preserves tenant data. Platform audit is for platform operations and is not a tenant CRM audit log.

## Future requirements

- Keep customer data tenant isolated and expose only fields needed for the current staff workflow.
- Treat internal notes, allergies, birthdays, preferences, and purchase history as sensitive. Define who may read each category before adding it.
- Never infer marketing permission from a phone number, account, order, or reservation. Any future marketing channel requires an explicit opt-in/opt-out model with source and time, subject to product/legal review.
- Design deletion, archive, anonymization, retention, and export with Orders/Reservations owners before implementation; preserve source records and their operational integrity.
- Keep logs, audit summaries, event envelopes, and campaign job errors free of full phone, message content, free-text notes, OTPs, and secrets.
- Scope exports and bulk operations to the resolved café and audit consequential actions without duplicating customer PII.

## Open product/legal decisions

Retention periods, deletion rights, consent wording/evidence, sensitive-field policy, and export format have not been established here. Record a decision with the product/legal owner before implementing the related behavior. This document does not invent legal policy.
