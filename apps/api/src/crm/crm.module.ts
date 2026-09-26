import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CrmContact, CrmDeal, CrmDealStageHistory, CrmLead, CrmLeadStatusHistory, CrmOrganization } from "./entities";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CrmLeadController } from "./crm-lead.controller";
import { CrmLeadService } from "./crm-lead.service";
import { CrmDealController } from "./crm-deal.controller";
import { CrmDealService } from "./crm-deal.service";

@Module({ imports: [TypeOrmModule.forFeature([CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory, CrmDeal, CrmDealStageHistory]), AuthModule, AuthorizationModule, AuditModule], controllers: [CrmController, CrmLeadController, CrmDealController], providers: [CrmService, CrmLeadService, CrmDealService], exports: [CrmLeadService] })
export class CrmModule {}
