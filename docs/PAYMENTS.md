# Subscription payments

This domain handles cafe subscription renewal, not customer order payment.

## Components

- `PaymentGateway`: request, verify, and payment-URL contract.
- `SimulatedPaymentGateway`: development flow; production rejects it.
- `ZarinpalPaymentGateway`: v4 request/verify calls with a ten-second timeout.
- `payment_intents`: owner/platform-visible purchase, renewal, reactivation, trial-conversion, and upgrade invoices.
- `subscription_payments`: successful immutable financial-operation ledger.

## Checkout

Tenant checkout sends `planKey`, an 8–80 character idempotency key, expected subscription version, and expected plan update timestamp. Under the per-cafe lock the server expires stale intents, rejects a competing live intent, recalculates the preview, validates optimistic values, and snapshots operation, source/target plans, pricing, and effective period anchors. The external gateway request happens after the database transaction closes.

Intents expire after 15 minutes. Toman is stored internally; a validated safe-integer amount is multiplied by ten only for the Zarinpal rial request/verification boundary. Payment URLs are returned only for pending, unexpired intents with authority.

## Callback and verification

Zarinpal returns to the public callback with intent ID, authority, and `OK`/`NOK`:

1. Intent ID and authority must match.
2. Already-paid intent returns its prior result.
3. `NOK` becomes `CANCELED`; an elapsed intent becomes `EXPIRED`.
4. An existing unique subscription payment for the intent reconciles it to `PAID`.
5. A pending intent is atomically claimed as `VERIFYING`; claims older than five minutes may reset.
6. Verification uses the snapshotted amount, never callback/client input.
7. Verification failure becomes `FAILED` and queues an owner notification.
8. Success atomically settles the intent, payment ledger, entitlement periods, lifecycle projection, cafe status, and success notification, then redirects to the tenant admin result page.

Zarinpal codes 100 and 101 are accepted as verified success by the adapter. HTTP/provider failures map to a gateway error and never extend the subscription.

## Idempotency and authority

- Tenant/idempotency-key uniqueness prevents duplicate intent creation; a partial unique index permits only one live intent per tenant.
- Gateway authority is unique on intents.
- `payment_intent_id` and `(provider, provider_reference)` are unique on subscription payments. `provider_reference` stores the verified gateway reference; authority is retained separately.
- Subscription period mutation is serialized by a tenant advisory lock.
- The callback is public because the gateway cannot hold tenant admin auth, but it accepts no tenant ID and gains no administrative authority.

Tenant invoice list/detail is cafe-scoped. Platform invoice reads require both `subscriptions.manage` and `users.read`; they are read-only and may include cafe admin contact data.

## Production acceptance

Implementation and mocked contract tests are present. Production still requires `PAYMENT_PROVIDER=zarinpal`, a real GUID `ZARINPAL_MERCHANT_ID`, public HTTPS `PAYMENT_CALLBACK_BASE_URL`, and a real request/redirect/verify/duplicate/recovery test. Recurring billing, refunds UI, and customer order payments are not implemented.

