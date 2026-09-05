import { MiddlewareConsumer, Module, NestModule, RequestMethod } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Branch, CoffeeShop, Domain } from "../database/entities";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { PlatformTenantsController } from "./platform-tenants.controller";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { PublicTenantController } from "./public-tenant.controller";
import { TenantContextGuard } from "./tenant-context.guard";
import { TenantContextMiddleware } from "./tenant-context.middleware";
import { TenantsService } from "./tenants.service";
import { TenantAdminAccessController } from "./tenant-admin-access.controller";
import { PlatformAdminAccessController } from "./platform-admin-access.controller";
import { AuditModule } from "../audit/audit.module";

@Module({
  imports: [TypeOrmModule.forFeature([CoffeeShop, Branch, Domain]), AuthModule, AuthorizationModule, SubscriptionsModule, AuditModule],
  controllers: [PublicTenantController, PlatformTenantsController, TenantAdminAccessController, PlatformAdminAccessController],
  providers: [TenantsService, TenantContextGuard],
  exports: [TenantsService],
})
export class TenantsModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes(
      { path: "public/*path", method: RequestMethod.ALL },
      { path: "tenant/*path", method: RequestMethod.ALL },
    );
  }
}
