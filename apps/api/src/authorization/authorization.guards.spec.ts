import assert from "node:assert/strict";
import test from "node:test";
import { ExecutionContext, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { CoffeeShopStatus, DomainType } from "../database/entities";
import { TENANT_CONTEXT } from "../tenants/tenant-context";
import { AUTH_PRINCIPAL, AuthorizedRequest, MEMBERSHIP_CONTEXT } from "./auth-principal";
import { AuthorizationService } from "./authorization.service";
import { PlatformPermissionGuard } from "./platform-permission.guard";
import { PlatformPermissions, TenantPermissions } from "./permission.constants";
import { TenantPermissionGuard } from "./tenant-permission.guard";
import { getRequestObservabilityContext, runWithRequestObservability } from "../observability/request-context";
import { ClientAccessTokenGuard } from "../clients/client-access-token.guard";
import { JwtService } from "@nestjs/jwt";

function executionContext(request: AuthorizedRequest): ExecutionContext {
  return {
    getHandler: () => function handler() {},
    getClass: () => class Controller {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function reflectorWith(value: unknown): Reflector {
  return { getAllAndOverride: () => value } as unknown as Reflector;
}

const tenant = {
  coffeeShopId: "tenant-a",
  slug: "tenant-a",
  status: CoffeeShopStatus.Active,
  locale: "fa-IR",
  timezone: "Asia/Tehran",
  hostname: "tenant-a.u-cafe.localhost",
  domainType: DomainType.PlatformSubdomain,
};

test("tenant guard requires an authenticated principal", async () => {
  const guard = new TenantPermissionGuard(reflectorWith([TenantPermissions.MenuManage]), {} as AuthorizationService);
  const request: AuthorizedRequest = { headers: {}, [TENANT_CONTEXT]: tenant };
  await assert.rejects(() => guard.canActivate(executionContext(request)), UnauthorizedException);
});

test("tenant guard rejects requests without hostname-resolved tenant context", async () => {
  const guard = new TenantPermissionGuard(reflectorWith([TenantPermissions.MenuManage]), {} as AuthorizationService);
  const request: AuthorizedRequest = { headers: {}, [AUTH_PRINCIPAL]: { userId: "user-a", sessionId: "session-a" } };
  await assert.rejects(() => guard.canActivate(executionContext(request)), NotFoundException);
});

test("tenant guard scopes authorization to the resolved tenant and attaches membership context", async () => {
  const authorization = {
    authorizeTenant: async (userId: string, tenantId: string) => {
      assert.equal(userId, "user-a");
      assert.equal(tenantId, "tenant-a");
      return { permitted: true, membershipId: "membership-a" };
    },
  } as unknown as AuthorizationService;
  const guard = new TenantPermissionGuard(reflectorWith([TenantPermissions.MenuManage]), authorization);
  const request: AuthorizedRequest = {
    headers: {},
    [AUTH_PRINCIPAL]: { userId: "user-a", sessionId: "session-a" },
    [TENANT_CONTEXT]: tenant,
  };
  assert.equal(await guard.canActivate(executionContext(request)), true);
  assert.deepEqual(request[MEMBERSHIP_CONTEXT], { membershipId: "membership-a", coffeeShopId: "tenant-a" });
});

test("successful guards set only the bounded actor category in request-local context", async () => {
  for (const [roleKey, expectedRole] of [["owner", "tenant_owner"], ["content_editor", "tenant_staff"]] as const) {
    const authorization = { authorizeTenant: async () => ({ permitted: true, membershipId: "membership-a", roleKeys: [roleKey] }) } as unknown as AuthorizationService;
    const guard = new TenantPermissionGuard(reflectorWith([TenantPermissions.MenuManage]), authorization);
    const request: AuthorizedRequest = {
      headers: {},
      [AUTH_PRINCIPAL]: { userId: "user-a", sessionId: "session-a" },
      [TENANT_CONTEXT]: tenant,
    };
    await runWithRequestObservability("123e4567-e89b-42d3-a456-426614174000", "menu", async () => {
      assert.equal(await guard.canActivate(executionContext(request)), true);
      assert.equal(getRequestObservabilityContext()?.actorRole, expectedRole);
    });
  }

  const platformGuard = new PlatformPermissionGuard(reflectorWith([PlatformPermissions.TenantsRead]), {
    hasPlatformPermissions: async () => true,
  } as unknown as AuthorizationService);
  const platformRequest: AuthorizedRequest = { headers: {}, [AUTH_PRINCIPAL]: { userId: "platform-user", sessionId: "session-platform" } };
  await runWithRequestObservability("123e4567-e89b-42d3-a456-426614174001", "platform", async () => {
    assert.equal(await platformGuard.canActivate(executionContext(platformRequest)), true);
    assert.equal(getRequestObservabilityContext()?.actorRole, "platform_admin");
  });

  const clientGuard = new ClientAccessTokenGuard({
    verifyAsync: async () => ({ typ: "client_access", cafe: tenant.coffeeShopId, sub: "client-a", sid: "session-client", jti: "jti" }),
  } as unknown as JwtService, { findOne: async () => ({}) } as never);
  const clientRequest = { headers: { authorization: "Bearer synthetic" }, [TENANT_CONTEXT]: tenant } as unknown as AuthorizedRequest;
  await runWithRequestObservability("123e4567-e89b-42d3-a456-426614174002", "tenant_crm", async () => {
    assert.equal(await clientGuard.canActivate(executionContext(clientRequest)), true);
    assert.equal(getRequestObservabilityContext()?.actorRole, "client");
  });
});

test("tenant guard rejects a membership without all required permissions", async () => {
  const authorization = { authorizeTenant: async () => ({ permitted: false }) } as unknown as AuthorizationService;
  const guard = new TenantPermissionGuard(reflectorWith([TenantPermissions.MenuManage]), authorization);
  const request: AuthorizedRequest = {
    headers: {},
    [AUTH_PRINCIPAL]: { userId: "user-b", sessionId: "session-b" },
    [TENANT_CONTEXT]: tenant,
  };
  await assert.rejects(() => guard.canActivate(executionContext(request)), ForbiddenException);
});

test("platform guard never falls back to tenant membership", async () => {
  const authorization = {
    hasPlatformPermissions: async (userId: string) => {
      assert.equal(userId, "platform-user");
      return false;
    },
  } as unknown as AuthorizationService;
  const guard = new PlatformPermissionGuard(reflectorWith([PlatformPermissions.TenantsRead]), authorization);
  const request: AuthorizedRequest = {
    headers: {},
    [AUTH_PRINCIPAL]: { userId: "platform-user", sessionId: "session-platform" },
    [TENANT_CONTEXT]: tenant,
  };
  await assert.rejects(() => guard.canActivate(executionContext(request)), ForbiddenException);
});
