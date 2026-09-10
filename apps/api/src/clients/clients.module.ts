import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { AuthModule } from "../auth/auth.module";
import { OtpChallenge } from "../auth/entities";
import { ClientAccessTokenGuard } from "./client-access-token.guard";
import { ClientAddressesController } from "./client-addresses.controller";
import { ClientAuthController } from "./client-auth.controller";
import { ClientAuthService } from "./client-auth.service";
import { ClientsService } from "./clients.service";
import { Client, ClientAddress, ClientAuthSession } from "./entities";

@Module({
  imports: [TypeOrmModule.forFeature([Client, ClientAddress, ClientAuthSession, OtpChallenge]), AuthModule],
  controllers: [ClientAuthController, ClientAddressesController],
  providers: [ClientsService, ClientAuthService, ClientAccessTokenGuard],
  exports: [ClientsService, ClientAccessTokenGuard, TypeOrmModule],
})
export class ClientsModule {}
