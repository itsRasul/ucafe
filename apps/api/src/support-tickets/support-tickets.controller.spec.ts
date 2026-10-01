import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { GUARDS_METADATA, HEADERS_METADATA } from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA, TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { effectivePlatformPermissions } from "../authorization/authorization.service";
import { AUTH_PRINCIPAL } from "../authorization/auth-principal";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions, TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto, UpdateSupportTicketDto } from "./dto/support-ticket.dto";
import { PlatformSupportTicketsController } from "./platform-support-tickets.controller";
import { TenantSupportTicketsController } from "./tenant-support-tickets.controller";

test("tenant and platform Ticket controllers enforce the existing guards and scoped permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, TenantSupportTicketsController), [AccessTokenGuard, TenantContextGuard, TenantPermissionGuard]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, PlatformSupportTicketsController), [AccessTokenGuard, PlatformPermissionGuard]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantSupportTicketsController), [TenantPermissions.SupportTicketsUse]);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController), [PlatformPermissions.SupportTicketsView]);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController.prototype.reply), [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply]);
  assert.equal(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController.prototype.attachment), undefined);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController.prototype.manage), [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage]);
  for (const handler of [
    TenantSupportTicketsController.prototype.list,
    TenantSupportTicketsController.prototype.detail,
    TenantSupportTicketsController.prototype.create,
    TenantSupportTicketsController.prototype.reply,
    PlatformSupportTicketsController.prototype.list,
    PlatformSupportTicketsController.prototype.detail,
    PlatformSupportTicketsController.prototype.reply,
    PlatformSupportTicketsController.prototype.manage,
  ]) {
    assert.deepEqual(Reflect.getMetadata(HEADERS_METADATA, handler), [{ name: "Cache-Control", value: "private, no-store" }]);
  }
});

test("Ticket DTOs trim and bound user text and reject caller-owned scope fields", async () => {
  const create = plainToInstance(CreateSupportTicketDto, { department: "TECHNICAL", subject: "  Orders  ", message: "  Not working  " });
  assert.equal(create.subject, "Orders");
  assert.equal(create.message, "Not working");
  assert.equal((await validate(create)).length, 0);

  const blankReply = plainToInstance(CreateSupportTicketMessageDto, { message: "   " });
  assert.ok((await validate(blankReply)).some((error) => error.property === "message"));

  const forged = plainToInstance(PlatformSupportTicketListQueryDto, { page: 1, tenantId: "not-a-uuid", coffeeShopId: "other-tenant" });
  assert.ok((await validate(forged, { whitelist: true, forbidNonWhitelisted: true })).some((error) => error.property === "coffeeShopId"));
});

test("Platform search filters are trimmed and bounded; department management requires a valid department", async () => {
  const query = plainToInstance(PlatformSupportTicketListQueryDto, { search: "  UC-104  ", tenantSearch: "  Roastery  " });
  assert.equal(query.search, "UC-104");
  assert.equal(query.tenantSearch, "Roastery");
  assert.equal((await validate(query)).length, 0);
  const blankFilters = plainToInstance(PlatformSupportTicketListQueryDto, { search: " ", tenantSearch: "", status: "", department: "" });
  assert.equal((await validate(blankFilters)).length, 0);

  const change = plainToInstance(UpdateSupportTicketDto, { action: "CHANGE_DEPARTMENT", department: "SALES" });
  assert.equal((await validate(change)).length, 0);
  const invalid = plainToInstance(UpdateSupportTicketDto, { action: "CHANGE_DEPARTMENT", department: "FINANCE" });
  assert.ok((await validate(invalid)).some((error) => error.property === "department"));
  const missing = plainToInstance(UpdateSupportTicketDto, { action: "CHANGE_DEPARTMENT" });
  assert.ok((await validate(missing)).some((error) => error.property === "department"));
  const ignoredInvalid = plainToInstance(UpdateSupportTicketDto, { action: "CLOSE", department: "FINANCE" });
  assert.ok((await validate(ignoredInvalid)).some((error) => error.property === "department"));
});

test("Platform reply and manage permissions imply view in the existing RBAC projection", () => {
  assert.ok(effectivePlatformPermissions(["support.tickets.reply"]).has("support.tickets.view"));
  assert.ok(effectivePlatformPermissions(["support.tickets.manage"]).has("support.tickets.view"));
  assert.equal(effectivePlatformPermissions(["support.tickets.view"]).has("support.tickets.reply"), false);
});

test("direct Platform list, reply, and manage requests are rejected without their server permissions", async () => {
  const calls: string[][] = [];
  const authorization = {
    hasPlatformPermissions: async (_userId: string, required: string[]) => { calls.push(required); return false; },
  } as unknown as import("../authorization/authorization.service").AuthorizationService;
  const guard = new PlatformPermissionGuard(new Reflector(), authorization);
  const request = { [AUTH_PRINCIPAL]: { userId: "support-user", sessionId: "session-id" } };
  const context = (handler: Function) => ({
    getHandler: () => handler,
    getClass: () => PlatformSupportTicketsController,
    switchToHttp: () => ({ getRequest: () => request }),
  }) as any;

  for (const handler of [
    PlatformSupportTicketsController.prototype.list,
    PlatformSupportTicketsController.prototype.attachment,
    PlatformSupportTicketsController.prototype.reply,
    PlatformSupportTicketsController.prototype.manage,
  ]) {
    await assert.rejects(() => guard.canActivate(context(handler)), ForbiddenException);
  }
  assert.deepEqual(calls, [
    [PlatformPermissions.SupportTicketsView],
    [PlatformPermissions.SupportTicketsView],
    [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply],
    [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage],
  ]);
});
