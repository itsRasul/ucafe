import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CrmActivity, CrmContact, CrmDeal, CrmDealStageHistory, CrmLead, CrmLeadStatusHistory, CrmNote, CrmOrganization, CrmTask } from "./entities";
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

@Module({ imports: [TypeOrmModule.forFeature([CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory, CrmDeal, CrmDealStageHistory, CrmActivity, CrmTask, CrmNote]), AuthModule, AuthorizationModule, AuditModule], controllers: [CrmController, CrmLeadController, CrmDealController, CrmWorkController], providers: [CrmService, CrmLeadService, CrmDealService, CrmActivityService, CrmTaskService, CrmNoteService, CrmOrganization360Service, CrmTimelineService], exports: [CrmLeadService] })
export class CrmModule {}
