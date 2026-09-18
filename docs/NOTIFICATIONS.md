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

This is not a general event bus. The worker scaffold is unused. Before horizontal API scaling, move dispatch to one coordinated worker or make claiming atomic across replicas.

## Implemented events

- authentication: administrative/client OTP (direct provider call)
- platform: `REQUEST_COUNSELING`
- orders: placed, confirmed/preparing, pickup-ready, courier-dispatched, completed, canceled, optional new-order owner alert
- reservations: placed, staff-created confirmed, confirmed, staff-edited, canceled, optional new-reservation owner alert, scheduled reminder
- subscriptions/payments: 3/2/1-day and last-day reminders, expired, three-day follow-up, successfully paid/activated, failed verification

Owner recipients are active users with active memberships carrying the tenant `owner` system role. New-order/new-reservation owner alerts are controlled by tenant settings.

## Idempotency and eligibility

- Event keys normally combine type and entity; owner fan-out adds user ID.
- Edits include the updated timestamp; subscription schedules include the current period-end timestamp.
- Duplicate inserts use `ON CONFLICT DO NOTHING`.
- Reservation reminders recheck confirmed/future state.
- Subscription scheduled sends recheck the relevant current period before delivery.
- Ineligible scheduled rows are completed with `NO_LONGER_ELIGIBLE` rather than sent.

## Configuration caveat

`SUBSCRIPTION_FAILD_PAID` is misspelled in the current enum/config contract. Treat it as a compatibility key until code, deployment secrets, and docs can be migrated together.

Real sms.ir delivery remains an external production acceptance gate for every configured template and parameter set.

