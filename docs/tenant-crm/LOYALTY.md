# Tenant CRM Loyalty and Rewards

## Boundary and eligibility

Loyalty belongs to one café and its existing `Client`. It uses the effective `tenant_crm` feature and existing `tenant_crm.read` / `tenant_crm.manage` permissions. Phone matches across cafés do not share accounts, balances, rewards, or history. No loyalty data is exposed by Client-authenticated APIs or Platform CRM.

The initial earning rule is one integer point per complete configured amount in toman: `floor(order.total_amount_toman / spend_per_point_toman)`. Only Orders in the terminal `DELIVERED` state qualify. The amount is UCafe's existing payable amount after stored discounts; it is not proof of payment collection or total customer spend. Canceled and unfinished Orders do not earn. The current Orders domain has no refund flow and Delivered is terminal, so there is no refund/cancellation reversal behavior.

Each program change inserts a new effective configuration row instead of rewriting the prior earning rule. The event's persisted creation time selects the rule that was in effect when delivery was recorded. Disabling the program prevents earning and redemption while retaining accounts, balances, and history. Authorized manual adjustments remain available while the program is disabled. The asynchronous processor checks the current tenant CRM entitlement before awarding points; if the feature is unavailable, the event is acknowledged without an award.

## Accounting and lifecycle

`tenant_crm_loyalty_ledger` is authoritative; no balance is cached. Its signed integer `points` are summed for current balance. EARN and MANUAL_CREDIT are positive; MANUAL_DEBIT and REDEMPTION are negative. The database check constraint ties each entry type to its source fields, and uniqueness permits at most one earning entry per café/order. Idempotency keys make repeated manual adjustment and redemption requests safe.

Accounts are created lazily on the first non-zero earning, manual adjustment, or redemption. An account row is locked for every point mutation, then the balance is derived from the ledger within the same transaction. Debits cannot make the balance negative. Blocked Clients remain readable, but cannot earn, receive manual adjustments, or redeem.

Rewards are tenant-owned, integer-cost records. Staff may edit or deactivate them; they are not hard-deleted. Redemption is a staff-recorded fulfillment, not a checkout, coupon, or Discount. The redemption and negative ledger entry commit atomically and preserve reward-name and points-cost snapshots. Changing a Reward afterward does not rewrite history.

There is no points expiry, reversal entry, tier, referral, streak, campaign, automated birthday bonus, checkout integration, Discount integration, or loyalty analytics in Phase 5. Revisit reversals and adjustments when the Orders domain adds refunds or post-delivery cancellation.

## Order event processing

The Orders transaction writes `tenant.order.delivered` to `domain_event_outbox` with the Order status change. Orders have no dependency on Tenant CRM. PostgreSQL is the durable queue: workers claim with `SKIP LOCKED`, earning is idempotent in the ledger, failures retry with bounded backoff up to five attempts, and stale claims are recovered after five minutes. Exhausted events remain as `FAILED` rows for operational review. A repeated event or a second event for the same Order cannot create another EARN entry.

## API and user experience

Read routes require `tenant_crm.read` and the effective feature; mutations additionally require `tenant_crm.manage`:

| Route | Behavior |
| --- | --- |
| `GET/PATCH /tenant/crm/loyalty/program` | Read the current program or add a new enabled/rate version. |
| `GET/POST /tenant/crm/loyalty/rewards` | List rewards or create one. |
| `PATCH /tenant/crm/loyalty/rewards/:rewardId` | Edit or activate/deactivate a same-café Reward. |
| `GET /tenant/crm/clients/:clientId/loyalty` | Return current balance, active reward eligibility, and short ledger/redemption previews. |
| `GET /tenant/crm/clients/:clientId/loyalty/ledger?page=&pageSize=` | Return current ledger history and balance, with bounded pagination. |
| `POST /tenant/crm/clients/:clientId/loyalty/adjust` | Record an idempotent reasoned credit or debit. |
| `POST /tenant/crm/clients/:clientId/loyalty/redeem` | Atomically record an eligible staff redemption and point debit. |

The `/admin/crm/loyalty` workspace manages the program and reward catalog. Customer 360 shows the balance, eligible active rewards, recent redemptions, and paginated ledger history. Adjustment reasons and staff actor labels are internal; displayed actor phones are masked. The timeline remains a bounded projection, not a durable event history.

## Segments, analytics, and future phases

Phase 4 Segment criteria remain unchanged and do not store or calculate loyalty membership. This phase adds no analytics aggregates or cached counters. Future Segment/Analytics use requires a separately defined query contract and measured need; future Campaigns must define consent and eligibility before using Loyalty. Feedback and service recovery are implemented separately in [FEEDBACK.md](FEEDBACK.md).

## Phase 6 independence

Feedback does not award, debit, or otherwise mutate points. A manager may use existing Phase 5 manual adjustment controls separately when authorized, but no automatic Loyalty consequence is tied to a rating or resolution.


## Phase 7 boundary

Commercial Offers use the existing Discounts/Promotion engine and do not read, grant, or redeem Loyalty points. Promotion eligibility may target CRM Segments through the separate Offer audience snapshot. Loyalty balances, reward inventory, and redemption accounting remain owned by this document's existing Loyalty model.
