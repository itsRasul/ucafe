# Reservations

## Model

`reservation_settings` belong to the primary branch. `reservations` carry cafe, branch, and client ownership plus contact-name, ISO date/time, party size, notes, status, and optional acting admin metadata.

Settings cover enabled state, slot interval, duration, minimum/maximum party, maximum concurrent guests, lead minutes, advance days, owner alert, and reminder lead hours.

## Availability

Availability requires the `reservations` plan feature and an enabled active primary branch/settings record. The service:

- validates real Gregorian `YYYY-MM-DD` input in branch timezone
- restricts date to today through `maximumAdvanceDays`
- uses that weekday's opening hours; closed/missing hours return no slots
- generates interval-aligned slots whose end is no later than closing
- rejects parties outside configured bounds
- applies same-day minimum lead time
- counts overlapping `PENDING` and `CONFIRMED` guests against concurrent capacity

Overnight opening ranges are not supported. The web displays/accepts Jalali dates and converts at the API boundary; storage remains Gregorian `date` plus PostgreSQL `time`.

## Client creation

`POST /public/reservations` requires tenant context, public availability, and a tenant-scoped client token. Creation takes an advisory transaction lock keyed by branch/date, regenerates availability, and saves `PENDING`. The response and client history/detail omit phone.

## Staff creation and management

Tenant `reservations.manage` staff may create a booking by phone, optional name, date, time, party size, and note:

- phone is normalized and client resolution is locked per tenant/phone
- an existing cafe client is reused
- a new client requires a name, is split on the first space, and remains phone-unverified
- the reservation is immediately `CONFIRMED` and records the acting admin

Admin list/detail returns client phone only behind tenant permission guards. An active booking can be rescheduled/re-sized after a locked capacity recheck excluding itself.

## Status transitions

```text
PENDING   -> CONFIRMED | REJECTED | CANCELED
CONFIRMED -> CANCELED | COMPLETED | NO_SHOW
REJECTED, CANCELED, COMPLETED, NO_SHOW -> terminal
```

Status changes use a pessimistic row lock, record actor/time, and enqueue confirmation or cancellation notifications where implemented. There is no client self-cancellation endpoint or confirmed cancellation-window policy.

## Notifications and concurrency

Public placement notifies the client and optionally owners. Staff placement uses a distinct already-confirmed template and does not notify owners of their own action. Confirmation, staff edit, cancellation, and scheduled reminder messages have stable deduplication keys. Reminder delivery rechecks that the reservation is still confirmed and in the future.

The advisory branch/date lock is the authoritative overbooking control. UI slot availability alone is never sufficient.

