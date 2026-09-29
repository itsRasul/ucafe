# Tenant CRM Feedback

## Purpose and ownership

Feedback stores the actual satisfaction response received by one café about one of its existing Clients. It belongs to Tenant CRM and is separate from Platform CRM, review invitations, and support ticketing. Client remains the customer identity; Order and Reservation remain authoritative for their own lifecycle and details.

Each record contains a required integer rating from 1 to 5, optional customer comment, source (`MANUAL` or `CUSTOMER_PANEL`), optional same-tenant/same-Client Order or Reservation link, recovery status, creation/update timestamps, and, after resolution, resolver, resolved timestamp, and optional internal resolution note. Empty or whitespace comments are stored as null. A rating is always present, so the record cannot be empty.

`MANUAL` is entered by an authorized tenant staff member and requires the creator membership. `CUSTOMER_PANEL` is submitted by the authenticated Client and must point to exactly one qualifying source record; it has no staff creator. No review-request integration exists, so sources such as `REVIEW_REQUEST`, `ORDER`, `RESERVATION`, or `OTHER` are not accepted as source enum values. Source identifies the submission channel; relation IDs identify context.

## Related Order and Reservation

A customer submission can relate to one delivered Order (`DELIVERED`) or one completed Reservation (`COMPLETED`). The API resolves each relation by trusted tenant, authenticated Client, and source ID before insertion. Composite foreign keys repeat the same-tenant/same-Client guarantee in PostgreSQL. Partial unique indexes allow at most one Feedback per Order and at most one per Reservation; a duplicate returns a conflict. Unlinked manual Feedback is allowed. Order/Reservation IDs and their history are not copied into Feedback.

Client deletion cascades its Feedback according to the existing Client lifecycle. Linked Orders and Reservations are restrictive, so they cannot be hard-deleted while Feedback refers to them. Tenant deletion removes tenant Feedback. There is no Feedback edit, archive, or hard-delete route; corrections and retention policy require a future explicit workflow.

## Rating, summary, and status

Ratings are 1–5 stars. UCafe's fixed negative threshold is rating `<= 2`; creation at that threshold starts at `NEEDS_ATTENTION`. Ratings 3–5 start at `NEW`. No comment classification, AI, or configurable threshold is used.

Lifecycle is `NEW` (not reviewed), `NEEDS_ATTENTION` (staff follow-up identified), and `RESOLVED` (recovery complete). Staff with `tenant_crm.manage` may mark a new item for attention and resolve either open state. Resolve is row-locked and records `resolved_at`, `resolved_by_user_id`, and an optional internal note atomically. Repeating resolve is idempotent and does not replace the first resolution. Resolved Feedback cannot be reopened. No status transition history is stored.

Customer 360 reports total count, one-decimal PostgreSQL-rounded average rating, count at or below 2, count currently needing attention, and latest feedback time. All values are scoped to tenant and Client. It loads only the latest five Feedback rows. Timeline projects `FEEDBACK_RECEIVED` at creation and `FEEDBACK_RESOLVED` at the stored resolution timestamp; event keys include Feedback UUID and event kind. Timeline metadata carries rating and source, never customer comments or internal resolution notes.

## Operations and integrations

`/admin/crm/feedback` provides a tenant-paginated inbox with Client/name/phone/comment search, status, rating, source and café-timezone created-date filters, and allowlisted creation/rating/update sorting. List phone values are masked. Detail shows customer text, source, related record and recovery state. Managers can mark attention, resolve with an internal note, or create a Phase 3 Reminder for the same Client through the existing reminder endpoint. The Reminder remains the follow-up source of truth; its description stores a short Feedback ID reference. There is no new follow-up/task model.

The customer panel offers a rating and optional comment on that authenticated Client's delivered Order or completed Reservation. Its read endpoint returns only that Client's own rating, comment, source and creation time; it never returns recovery status, resolution note, staff identity, or Reminder data. Tenant Admin reads require `tenant_crm.read`; writes require both `tenant_crm.read` and `tenant_crm.manage`. Customer routes use the existing Client access token and public Tenant guards. All routes require effective `tenant_crm` entitlement.

## Privacy and limits

Customer comments may include personal information and are visible only to authorized users of the owning café. Resolution notes are internal staff text. Customer endpoints expose only the authenticated Client's own response fields. Feedback is not exposed through Platform CRM or other tenants. Client deletion currently cascades CRM-owned rows; no separate legal retention/anonymization policy is defined here.

Phase 6 does not add tickets, threads, public replies, attachments, SLA/routing, review invitations, campaigns, offers, automatic SMS, AI sentiment, automatic Loyalty changes, Segment fields, or cross-client satisfaction analytics. Future Offers, Campaigns, Automation, and Phase 10 analytics must define their own eligibility, consent, time windows, and historical semantics before consuming Feedback.


## Phase 7 boundary

Offers do not trigger feedback requests, customer recovery, SMS, or workflow actions. Offer Timeline entries are read projections from audience membership and saved Order discount snapshots; they do not modify Feedback records.
