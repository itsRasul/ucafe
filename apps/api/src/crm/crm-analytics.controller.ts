import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { AccessTokenGuard } from "../auth/access-token.guard";
import { RequirePlatformPermissions } from "../authorization/authorization.decorators";
import { PlatformPermissionGuard } from "../authorization/platform-permission.guard";
import { PlatformPermissions } from "../authorization/permission.constants";
import { CrmAnalyticsQueryDto } from "./dto/crm-analytics.dto";
import { CrmAnalyticsService } from "./crm-analytics.service";

@Controller("platform/crm/analytics")
@UseGuards(AccessTokenGuard, PlatformPermissionGuard)
export class CrmAnalyticsController {
  constructor(private readonly analytics: CrmAnalyticsService) {}

  @Get("overview") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  overview(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.overview(query); }

  @Get("funnel") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  funnel(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.funnel(query); }

  @Get("pipeline") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  pipeline(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.pipeline(query); }

  @Get("sources") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  sources(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.sources(query); }

  @Get("work") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  work(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.work(query); }

  @Get("owners") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  owners(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.owners(query); }

  @Get("scoring") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  scoring(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.scoring(query); }

  @Get("automation") @RequirePlatformPermissions(PlatformPermissions.CrmRead)
  automation(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.automation(query); }

  @Get("customers") @RequirePlatformPermissions(PlatformPermissions.CrmRead, PlatformPermissions.SubscriptionsRead)
  customers(@Query() query: CrmAnalyticsQueryDto) { return this.analytics.customers(query); }
}
