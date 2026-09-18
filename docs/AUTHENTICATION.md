# Authentication

ucafe has two intentionally separate OTP identity domains.

## Administrative users

`users` represent platform operators and cafe owners/staff. `POST /api/v1/auth/otp/request` creates a `LOGIN` challenge not associated with a cafe. Verification requires an existing active user with applicable access; an invited cafe membership becomes active when its user first verifies the phone.

Successful verification returns a short-lived JWT access token and sets a rotating opaque refresh token in an HttpOnly cookie. Access tokens identify user/session only; permissions are loaded from the database on each authorized operation.

## Cafe clients

`clients` represent customers and are unique by `(coffee_shop_id, phone)`. `/api/v1/public/client-auth/*` resolves the tenant from the host and uses `CLIENT_LOGIN` challenges scoped to that cafe.

- Login to an existing active client does not require names.
- Registration requires first and last name after OTP verification.
- The same phone can have separate client records and sessions at different cafes.
- A client access JWT includes client ID, session ID, and cafe ID; the guard requires all three to match the active session and resolved tenant.
- Client phone change uses a fresh tenant-scoped OTP, rejects a duplicate cafe phone, keeps the current session, and revokes the client's other sessions.

## OTP rules

- Iranian phone inputs are normalized to E.164.
- Codes are six digits, stored only as keyed hashes, expire after `OTP_TTL_SECONDS`, and lock after `OTP_MAX_ATTEMPTS`.
- Resend cooldown and hourly phone/IP limits are configuration-driven. Current rate counting is stored/query-backed in PostgreSQL, not Redis.
- Creating a new challenge cancels earlier pending challenges in the same scope.
- Plain OTP is sent to the selected provider and is never persisted.
- `development` logs a masked destination and OTP only outside production. Production configuration requires `SMS_PROVIDER=smsir`.

## Sessions

- Access-token TTL defaults to 600 seconds and is constrained to 60–3600 seconds.
- Refresh-session TTL defaults to 30 days and is constrained to 1–90 days.
- Refresh tokens are random opaque values; only their hashes are stored.
- Each refresh rotates to a new session in the same token family and revokes the prior session.
- Reuse of a rotated token marks/revokes the family as compromised.
- Logout revokes the presented refresh session; blocked/deleted identities fail subsequent guard checks.
- Admin and client refresh cookies use separate API paths; the Next proxy rewrites them to same-origin `/api/backend` paths.

The web keeps access tokens in client state/session storage and relies on HttpOnly refresh cookies for renewal. Do not move sensitive tokens into URLs or persistent logs.

## PII and logging

Administrative user phone is normalized and stored in `users`; OTP challenge phone copies and notification recipients are authenticated-encrypted using `PII_ENCRYPTION_KEY`. Client phone is stored in the tenant-scoped `clients` table to support operational workflows. Logs must mask phone values and omit bodies, tokens, OTPs, ciphertext, and provider secrets.

Public/client reservation projections never include phone. Protected tenant order/reservation admin responses expose the tenant client's phone for operations. Full administrative user phones are restricted to protected platform `users.read` views.

## Endpoints

- Admin/platform: `auth/otp/request`, `auth/otp/verify`, `auth/refresh`, `auth/logout`, `auth/me`.
- Client: `public/client-auth/otp/request`, `otp/verify`, `refresh`, `logout`, `me`.
- Client profile phone change: `public/client-panel/profile/phone/otp/request|verify`.

