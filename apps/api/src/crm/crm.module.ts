import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CrmActivity, CrmContact, CrmCustomFieldDefinition, CrmCustomFieldOption, CrmDeal, CrmDealStageHistory, CrmEntityTag, CrmLead, CrmLeadStatusHistory, CrmNote, CrmOrganization, CrmSavedView, CrmSegment, CrmTag, CrmTask } from "./entities";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CrmLeadController } from "./crm-lead.controller";
import { CrmLeadService } from "./crm-lead.service";
import { CrmDealController } from "./crm-deal.controller";
import { CrmDealService } from "./crm-deal.service";
import { CrmWorkController } from "./crm-work.controller";
import { CrmActivityService } from "./crm-activity.service";
import { CrmTaskService } from "./crm-task.service";
import { CrmNoteService } from "./crm-note.service";
import { CrmOrganization360Service } from "./crm-organization-360.service";
import { CrmTimelineService } from "./crm-timeline.service";
import { CrmCustomerContextService } from "./crm-customer-context.service";
import { CrmMetadataController } from "./crm-metadata.controller";
import { CrmMetadataService } from "./crm-metadata.service";
import { CrmFilterService } from "./crm-filter.service";
import { CrmSavedViewController } from "./crm-saved-view.controller";
import { CrmSavedViewService } from "./crm-saved-view.service";
import { CrmSegmentController } from "./crm-segment.controller";
import { CrmSegmentService } from "./crm-segment.service";
import { CrmScoringController } from "./crm-scoring.controller";
import { CrmScoringService } from "./crm-scoring.service";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TenantsModule } from "../tenants/tenants.module";
import { CrmWorkflowController } from "./crm-workflow.controller";
import { CrmWorkflowEventService } from "./crm-workflow-event.service";
import { CrmWorkflowService } from "./crm-workflow.service";
import { CrmWorkflowRuntimeService } from "./crm-workflow-runtime.service";
import { CrmAnalyticsController } from "./crm-analytics.controller";
import { CrmAnalyticsService } from "./crm-analytics.service";

@Module({ imports: [TypeOrmModule.forFeature([CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory, CrmDeal, CrmDealStageHistory, CrmActivity, CrmTask, CrmNote, CrmCustomFieldDefinition, CrmCustomFieldOption, CrmTag, CrmEntityTag, CrmSavedView, CrmSegment]), AuthModule, AuthorizationModule, AuditModule, TenantsModule, SubscriptionsModule], controllers: [CrmController, CrmLeadController, CrmDealController, CrmWorkController, CrmMetadataController, CrmSavedViewController, CrmSegmentController, CrmScoringController, CrmWorkflowController, CrmAnalyticsController], providers: [CrmService, CrmLeadService, CrmDealService, CrmActivityService, CrmTaskService, CrmNoteService, CrmOrganization360Service, CrmTimelineService, CrmCustomerContextService, CrmMetadataService, CrmFilterService, CrmSavedViewService, CrmSegmentService, CrmScoringService, CrmWorkflowEventService, CrmWorkflowService, CrmWorkflowRuntimeService, CrmAnalyticsService], exports: [CrmLeadService] })
export class CrmModule {}
