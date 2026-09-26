import { Injectable, NotFoundException } from "@nestjs/common";
import { DataSource } from "typeorm";
import { TenantsService } from "../tenants/tenants.service";
import { SubscriptionsService } from "../subscriptions/subscriptions.service";

@Injectable()
export class CrmCustomerContextService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenants: TenantsService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async get(organizationId: string) {
    const organizations = await this.dataSource.query<Array<{ coffeeShopId: string | null }>>(
      "SELECT coffee_shop_id AS \"coffeeShopId\" FROM crm_organizations WHERE id=$1", [organizationId],
    );
    if (!organizations[0]) throw new NotFoundException("CRM Organization not found");
    const tenantId = organizations[0].coffeeShopId;
    if (!tenantId) return { tenantId: null, tenant: null, subscription: null, sectionErrors: [] };

    const [tenantResult, subscriptionResult] = await Promise.allSettled([
      this.tenants.getCrmContext(tenantId),
      this.subscriptions.getCrmContext(tenantId),
    ]);
    return {
      tenantId,
      tenant: tenantResult.status === "fulfilled" ? tenantResult.value : null,
      subscription: subscriptionResult.status === "fulfilled" ? subscriptionResult.value : null,
      sectionErrors: [
        ...(tenantResult.status === "rejected" ? ["tenant"] : []),
        ...(subscriptionResult.status === "rejected" ? ["subscription"] : []),
      ],
    };
  }
}
