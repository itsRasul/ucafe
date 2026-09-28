# Tenant CRM identity

## User and Client

User is an administrative/authenticated operator identity. It participates in platform or tenant memberships, roles, and permissions. A tenant User acts on CRM records.

Client is a café's customer identity. It is the subject of CRM activity and is tenant-owned. A Client does not operate tenant-admin CRM APIs and is not the same entity as a User.

## Current Client lifecycle

OTP registration resolves or creates Client by normalized E.164 phone within the resolved café. Staff reservation creation may create a name-bearing Client without OTP verification. Phone changes require a verified OTP flow and reject a duplicate phone in the same café. The same normalized phone is permitted in another café because the uniqueness key includes coffee_shop_id.

Client has first and last name, phone, ACTIVE/BLOCKED status, phone verification/authentication timestamps, and created/updated timestamps. It has no email or global linked identity. Current public Client APIs are tenant/client-token scoped; protected owner workflows may show full phone where operationally required. Existing customer-segment search masks phone in returned summaries.

## Phase 1 duplicate handling

Use exact normalized phone within the current café as the deterministic search/identity signal. The unique database constraint is authoritative. Do not auto-merge by name, fuzzy match, global phone, or unlinked User identity. Phase 1 adds no Client creation path; existing OTP registration and staff reservation flows remain authoritative and tenant scoped.

No Client merge is included in Phase 1. A later merge needs an explicit operator-confirmation flow and transactionally safe reassignment or preservation of Orders, Reservations, addresses, sessions, promotions, segments, and every CRM-owned relationship.

## Actor attribution

For future CRM-owned notes or edits, clientId is the subject and createdByUserId/updatedByUserId is the administrative actor where appropriate. Never use Client as creator or attribute a staff action to the customer's identity.
