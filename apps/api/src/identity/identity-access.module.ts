import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { CoffeeShopMembership, MembershipRole, Permission, Role, RolePermission, User, UserPlatformRole } from "./entities";

@Module({
  imports: [TypeOrmModule.forFeature([User, CoffeeShopMembership, Role, Permission, MembershipRole, RolePermission, UserPlatformRole])],
  exports: [TypeOrmModule],
})
export class IdentityAccessModule {}
