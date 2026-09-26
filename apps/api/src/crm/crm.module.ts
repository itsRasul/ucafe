import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuditModule } from "../audit/audit.module";
import { AuthModule } from "../auth/auth.module";
import { AuthorizationModule } from "../authorization/authorization.module";
import { CrmContact, CrmOrganization } from "./entities";
import { CrmController } from "./crm.controller";
import { CrmService } from "./crm.service";

@Module({ imports: [TypeOrmModule.forFeature([CrmOrganization, CrmContact]), AuthModule, AuthorizationModule, AuditModule], controllers: [CrmController], providers: [CrmService] })
export class CrmModule {}
