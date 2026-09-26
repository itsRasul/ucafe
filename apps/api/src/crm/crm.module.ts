import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CrmContact, CrmLead, CrmLeadStatusHistory, CrmOrganization } from "./entities";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";
import { CrmLeadController } from "./crm-lead.controller";
import { CrmLeadService } from "./crm-lead.service";

@Module({ imports: [TypeOrmModule.forFeature([CrmOrganization, CrmContact, CrmLead, CrmLeadStatusHistory]), AuthModule, AuthorizationModule, AuditModule], controllers: [CrmController, CrmLeadController], providers: [CrmService, CrmLeadService], exports: [CrmLeadService] })
export class CrmModule {}
