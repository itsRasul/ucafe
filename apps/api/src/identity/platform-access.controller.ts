import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { AUTH_PRINCIPAL, AuthorizedRequest } from "../authorization/auth-principal";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CreateRoleDto, CreateUserDto, PlatformRolesQueryDto, PlatformUsersQueryDto, UpdateRoleDto, UpdateUserStatusDto } from "./dto/platform-access.dto";
import { PlatformAccessService } from "./platform-access.service";

@Controller("platform")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class PlatformAccessController {
  constructor(private readonly access: PlatformAccessService) {}
  @Get("users") @RequirePlatformPermissions(PlatformPermissions.UsersRead) listUsers(@Query() query: PlatformUsersQueryDto) { return this.access.listUsers(query); }
  @Post("users") @RequirePlatformPermissions(PlatformPermissions.UsersManage) createUser(@Body() input: CreateUserDto, @Req() request: AuthorizedRequest) { return this.access.createUser(input, request[AUTH_PRINCIPAL]!.userId); }
  @Get("users/:userId") @RequirePlatformPermissions(PlatformPermissions.UsersRead) getUser(@Param("userId", new ParseUUIDPipe()) userId: string) { return this.access.getUser(userId); }
  @Patch("users/:userId/status") @RequirePlatformPermissions(PlatformPermissions.UsersManage) updateStatus(@Param("userId", new ParseUUIDPipe()) userId: string, @Body() input: UpdateUserStatusDto, @Req() request: AuthorizedRequest) { return this.access.updateUserStatus(userId, input.status, request[AUTH_PRINCIPAL]!.userId); }
  @Post("users/:userId/platform-roles/:roleId") @RequirePlatformPermissions(PlatformPermissions.UsersManage) assignPlatformRole(@Param("userId", new ParseUUIDPipe()) userId: string, @Param("roleId", new ParseUUIDPipe()) roleId: string, @Req() request: AuthorizedRequest) { return this.access.assignPlatformRole(userId, roleId, request[AUTH_PRINCIPAL]!.userId); }
  @Delete("users/:userId/platform-roles/:roleId") @HttpCode(204) @RequirePlatformPermissions(PlatformPermissions.UsersManage) removePlatformRole(@Param("userId", new ParseUUIDPipe()) userId: string, @Param("roleId", new ParseUUIDPipe()) roleId: string, @Req() request: AuthorizedRequest) { return this.access.removePlatformRole(userId, roleId, request[AUTH_PRINCIPAL]!.userId); }
  @Post("memberships/:membershipId/roles/:roleId") @RequirePlatformPermissions(PlatformPermissions.UsersManage) assignMembershipRole(@Param("membershipId", new ParseUUIDPipe()) membershipId: string, @Param("roleId", new ParseUUIDPipe()) roleId: string, @Req() request: AuthorizedRequest) { return this.access.assignMembershipRole(membershipId, roleId, request[AUTH_PRINCIPAL]!.userId); }
  @Delete("memberships/:membershipId/roles/:roleId") @HttpCode(204) @RequirePlatformPermissions(PlatformPermissions.UsersManage) removeMembershipRole(@Param("membershipId", new ParseUUIDPipe()) membershipId: string, @Param("roleId", new ParseUUIDPipe()) roleId: string, @Req() request: AuthorizedRequest) { return this.access.removeMembershipRole(membershipId, roleId, request[AUTH_PRINCIPAL]!.userId); }
  @Get("roles") @RequirePlatformPermissions(PlatformPermissions.RolesRead) listRoles(@Query() query: PlatformRolesQueryDto) { return this.access.listRoles(query); }
  @Post("roles") @RequirePlatformPermissions(PlatformPermissions.RolesManage) createRole(@Body() input: CreateRoleDto, @Req() request: AuthorizedRequest) { return this.access.createRole(input, request[AUTH_PRINCIPAL]!.userId); }
  @Patch("roles/:roleId") @RequirePlatformPermissions(PlatformPermissions.RolesManage) updateRole(@Param("roleId", new ParseUUIDPipe()) roleId: string, @Body() input: UpdateRoleDto, @Req() request: AuthorizedRequest) { return this.access.updateRole(roleId, input, request[AUTH_PRINCIPAL]!.userId); }
  @Delete("roles/:roleId") @HttpCode(204) @RequirePlatformPermissions(PlatformPermissions.RolesManage) deleteRole(@Param("roleId", new ParseUUIDPipe()) roleId: string, @Req() request: AuthorizedRequest) { return this.access.deleteRole(roleId, request[AUTH_PRINCIPAL]!.userId); }
  @Get("permissions") @RequirePlatformPermissions(PlatformPermissions.PermissionsRead) listPermissions() { return this.access.listPermissions(); }
}
