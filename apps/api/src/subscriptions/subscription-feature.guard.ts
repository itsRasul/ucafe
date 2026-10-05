import { CanActivate, ExecutionContext, Injectable, NotFoundException, SetMetadata } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { TENANT_CONTEXT, TenantContextRequest } from "../tenants/tenant-context";
import { SubscriptionFeatureKey } from "./subscription-features";
import { SubscriptionsService } from "./subscriptions.service";

const FEATURE_METADATA = "subscription:feature";
export const RequireSubscriptionFeature = (feature: SubscriptionFeatureKey) => SetMetadata(FEATURE_METADATA, feature);

@Injectable()
export class SubscriptionFeatureGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly subscriptions: SubscriptionsService) {}

  async canActivate(context: ExecutionContext) {
    const feature = this.reflector.getAllAndOverride<SubscriptionFeatureKey>(FEATURE_METADATA, [context.getHandler(), context.getClass()]);
    const tenant = context.switchToHttp().getRequest<TenantContextRequest>()[TENANT_CONTEXT];
    if (!tenant || !feature) throw new NotFoundException("Tenant feature context is required");
    await this.subscriptions.requireFeature(tenant.coffeeShopId, feature);
    return true;
  }
}
