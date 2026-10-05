# Notifications and SMS

## Provider model

`SmsProvider` has two implementations:

- `development`: masked local logging; forbidden in production
- `smsir`: calls `POST https://api.sms.ir/v1/send/verify` with `x-api-key`, numeric `templateId`, and named parameters

sms.ir success requires a successful HTTP response, `status === 1`, and `data.messageId`. Parameter values are clamped to the provider's 25-character limit. Template names are not accepted; environment values must be positive numeric panel IDs.

OTP uses `SMSIR_OTP_TEMPLATE_ID` directly. Transactional notification template IDs are read from environment keys matching the `NotificationType` string values listed in `.env.example`.

## Durable outbox

`notification_deliveries` stores tenant/platform ownership, event type, related entity, globally unique deduplication key, encrypted recipient, JSON parameters, status, attempts, next-attempt time, provider ID, and error metadata.

Domain services normally enqueue in their business transaction. The API timer polls every five seconds, performs scheduled discovery once per minute, resets processing rows stale for five minutes, takes up to ten pending rows, and retries failures up to three times with exponential backoff. Logs contain type/tenant/entity metadata, never full phone, OTP, ciphertext, or template secret.

This is not a general event bus. The worker scaffold is unused. Pending-to-processing claims use a conditional database update so competing replicas cannot both claim a pending row. Stale processing resets after five minutes; dispatch failures are logged and retried by the next timer sweep. A provider acceptance with a lost response remains an at-least-once ambiguity.

## Implemented events

- authentication: administrative/client OTP (direct provider call)
- platform: `REQUEST_COUNSELING`
- orders: placed, confirmed/preparing, pickup-ready, courier-dispatched, completed, canceled, optional new-order owner alert
- reservations: placed, staff-created confirmed, confirmed, staff-edited, canceled, optional new-reservation owner alert, scheduled reminder
- trials: 7-day and 2-day reminders, unpaid expiration, three-day follow-up
- subscriptions/payments: 3/2/1-day and last-day reminders, expired, three-day follow-up, successfully paid/activated, failed verification
- support tickets: created and Tenant-replied alerts to active, verified Platform users with `support.tickets.reply`; Platform replies to the active creator with a verified phone and current `support.tickets.use` membership

Owner recipients are active users with active memberships carrying the tenant `owner` system role. New-order/new-reservation owner alerts are controlled by tenant settings.

## Idempotency and eligibility

- Event keys normally combine type and entity; owner fan-out adds user ID.
- Edits include the updated timestamp; subscription schedules include the authoritative `paid_through_at` timestamp.
- Duplicate inserts use `ON CONFLICT DO NOTHING`.
- Reservation reminders recheck confirmed/future state.
- Subscription scheduled sends recheck the relevant paid-through boundary before delivery, so early renewal invalidates stale reminders.
- Ticket events use the Ticket ID for creation and message ID plus recipient ID for replies/fan-out; multiple attachments do not create extra events.
- Successful-payment payloads keep the existing template but make its plan label operation-aware for activation, renewal, reactivation, and upgrade.
- Ineligible scheduled rows are completed with `NO_LONGER_ELIGIBLE` rather than sent.

Provider retries are at-least-once when the provider accepts a message but the response is lost; the current sms.ir contract has no provider idempotency key to eliminate that ambiguity.

## Configuration caveat

`SUBSCRIPTION_FAILD_PAID` is misspelled in the current enum/config contract. Treat it as a compatibility key until code, deployment secrets, and docs can be migrated together.

Real sms.ir delivery remains an external production acceptance gate for every configured template and parameter set.


## Initial trial reminders

`TRIAL_EXPIRING_7_DAYS`, `TRIAL_EXPIRING_2_DAYS`, `TRIAL_EXPIRED`, and `TRIAL_EXPIRED_FOLLOW_UP` are sms.ir verify-template environment keys, each with `cafeName`. Provision the four Persian templates and IDs before enabling sms.ir; startup requires their IDs with the existing SMS configuration validator. Suggested copy:

- −7: دوره آزمایشی یوکافه شما رو به پایان است. تنها ۷ روز باقی مانده؛ برای ادامه استفاده از امکانات، اشتراک خود را فعال کنید.
- −2: تنها ۲ روز تا پایان دوره آزمایشی یوکافه شما باقی مانده است. برای جلوگیری از قطع دسترسی، اشتراک خود را فعال کنید.
- Expired: دوره آزمایشی یوکافه شما به پایان رسید. برای ادامه استفاده از امکانات کافه، اشتراک خود را فعال کنید.
- +3: سه روز از پایان دوره آزمایشی یوکافه شما گذشته است. با فعال‌سازی اشتراک دوباره به امکانات یوکافه دسترسی داشته باشید.

The UTC elapsed-time windows are `(end−7d, end−6d)` including the first boundary, `(end−2d, end−1d)` including the first boundary, `[end, end+3d)`, and `[end+3d, end+7d)`. One-minute discovery catches missed timer ticks inside these windows. Pre-expiry copy is discarded after its one-day window; after a long outage, only the currently meaningful event is discovered. Historical trials older than seven days receive no follow-up backlog.

Keys contain event type, subscription ID, exact stored trial end and owner user ID. The existing unique key/conflict-safe insert and conditional processing claim protect repeat sweeps/restarts/replicas. Existing policy fans out once to each active owner-role member, not to all admins. Malformed/missing phones skip safely. Delivery also rechecks active membership/user, current phone, unchanged end, uncanceled/unconverted trial and the current message window. Deleted/archived tenants and suspended active trials are excluded; lifecycle-suspended expired trials remain eligible for expiry/follow-up. The current tenant model has no separate administrative suspension reason.

Any committed paid entitlement permanently suppresses trial messages, including queued expiry/follow-up. Pending/failed checkout does not extend entitlement. Provider verification delays retain the current payment policy: access activates at committed verification, and a payment can commit immediately after the last reminder eligibility read. SMS cannot be recalled; this unavoidable small race and the provider lost-response ambiguity are not exactly-once guarantees.
