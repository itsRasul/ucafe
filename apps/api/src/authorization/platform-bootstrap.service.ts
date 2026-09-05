import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import { DataSource, IsNull } from "typeorm";
import { AuthorizationScope, Role, User, UserPlatformRole } from "../identity/entities";
import { normalizeIranianMobile } from "../auth/iran-phone.util";

@Injectable()
export class PlatformBootstrapService {
  constructor(private readonly dataSource: DataSource) {}

  async claimFirstOwner(rawPhone: string): Promise<{ userId: string; roleKey: string }> {
    const phone = normalizeIranianMobile(rawPhone);
    return this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["cafexa:platform-owner-bootstrap"]);
      const user = await manager.findOneBy(User, { phone });
      if (!user?.phoneVerifiedAt) throw new NotFoundException("The phone must complete OTP authentication before platform bootstrap");

      const role = await manager.findOneByOrFail(Role, {
        key: "platform_owner",
        scope: AuthorizationScope.Platform,
        coffeeShopId: IsNull(),
      });
      const current = await manager.findOneBy(UserPlatformRole, { roleId: role.id });
      if (current && current.userId !== user.id) throw new ConflictException("A platform owner already exists");
      if (!current) await manager.save(UserPlatformRole, manager.create(UserPlatformRole, { userId: user.id, roleId: role.id }));

      return { userId: user.id, roleKey: role.key };
    });
  }
}
