import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { GUARDS_METADATA } from "@nestjs/common/constants";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { PLATFORM_PERMISSIONS_METADATA, TENANT_PERMISSIONS_METADATA } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions, TenantPermissions } from "../authorization/permission.constants";
import { TenantPermissionGuard } from "../authorization/tenant-permission.guard";
import { TenantContextGuard } from "../tenants/tenant-context.guard";
import { CreateSupportTicketDto, CreateSupportTicketMessageDto, PlatformSupportTicketListQueryDto } from "./dto/support-ticket.dto";
import { PlatformSupportTicketsController } from "./platform-support-tickets.controller";
import { TenantSupportTicketsController } from "./tenant-support-tickets.controller";

test("tenant and platform Ticket controllers enforce the existing guards and scoped permissions", () => {
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, TenantSupportTicketsController), [AccessTokenGuard, TenantContextGuard, TenantPermissionGuard]);
  assert.deepEqual(Reflect.getMetadata(GUARDS_METADATA, PlatformSupportTicketsController), [AccessTokenGuard, PlatformPermissionGuard]);
  assert.deepEqual(Reflect.getMetadata(TENANT_PERMISSIONS_METADATA, TenantSupportTicketsController), [TenantPermissions.SupportTicketsUse]);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController), [PlatformPermissions.SupportTicketsView]);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController.prototype.reply), [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsReply]);
  assert.deepEqual(Reflect.getMetadata(PLATFORM_PERMISSIONS_METADATA, PlatformSupportTicketsController.prototype.manage), [PlatformPermissions.SupportTicketsView, PlatformPermissions.SupportTicketsManage]);
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
