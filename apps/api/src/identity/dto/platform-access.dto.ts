import { Type } from "class-transformer";
import { ArrayUnique, IsArray, IsEnum, IsIn, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from "class-validator";
import { AuthorizationScope, UserStatus } from "../entities";

export class PlatformUsersQueryDto {
  @IsOptional() @IsString() @MaxLength(254) q?: string;
  @IsOptional() @IsEnum(UserStatus) status?: UserStatus;
  @IsOptional() @Type(() => Number) @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @Min(1) @Max(100) pageSize = 20;
}

export class PlatformRolesQueryDto {
  @IsOptional() @IsEnum(AuthorizationScope) scope?: AuthorizationScope;
  @IsOptional() @IsUUID() coffeeShopId?: string;
}

export class UpdateUserStatusDto {
  @IsIn([UserStatus.Active, UserStatus.Blocked]) status!: UserStatus.Active | UserStatus.Blocked;
}

export class CreateUserDto {
  @IsString() @MaxLength(32) phone!: string;
  @IsUUID() roleId!: string;
  @IsOptional() @IsUUID() coffeeShopId?: string;
}

export class CreateRoleDto {
  @IsEnum(AuthorizationScope) scope!: AuthorizationScope;
  @IsString() @Matches(/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/) @MaxLength(80) key!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsOptional() @IsUUID() coffeeShopId?: string;
  @IsArray() @ArrayUnique() @IsUUID("4", { each: true }) permissionIds!: string[];
}

export class UpdateRoleDto {
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @IsArray() @ArrayUnique() @IsUUID("4", { each: true }) permissionIds!: string[];
}
