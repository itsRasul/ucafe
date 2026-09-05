import assert from "node:assert/strict";
import test from "node:test";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AccessTokenPayload, AuthTokenService } from "./auth-token.service";

const secret = "test-only-access-token-secret-at-least-32-characters";
const jwt = new JwtService({ secret, signOptions: { algorithm: "HS256" } });
const tokens = new AuthTokenService(jwt, new ConfigService({ ACCESS_TOKEN_TTL_SECONDS: 600, REFRESH_TOKEN_TTL_DAYS: 30 }));

test("issues a short-lived access token containing only auth identifiers", async () => {
  const token = await tokens.issueAccessToken("user-a", "session-a");
  const payload = await jwt.verifyAsync<AccessTokenPayload & { exp: number; iat: number }>(token);
  assert.equal(payload.sub, "user-a");
  assert.equal(payload.sid, "session-a");
  assert.equal(payload.typ, "access");
  assert.match(payload.jti, /^[0-9a-f-]{36}$/);
  assert.ok(payload.exp - payload.iat <= 600);
});

test("calculates refresh expiry from the configured lifetime", () => {
  const now = new Date("2026-08-26T00:00:00.000Z");
  assert.equal(tokens.refreshTokenExpiresAt(now).toISOString(), "2026-09-25T00:00:00.000Z");
});
