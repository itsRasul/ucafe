import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { JwtModule } from "@nestjs/jwt";
import { TypeOrmModule } from "@nestjs/typeorm";
import { User } from "../identity/entities";
import { AccessTokenGuard } from "./access-token.guard";
import { AuthController } from "./auth.controller";
import { AuthCryptoService } from "./auth-crypto.service";
import { AuthTokenService } from "./auth-token.service";
import { AuthenticationService } from "./authentication.service";
import { DevelopmentSmsProvider } from "./development-sms.provider";
import { AuthSession, OtpChallenge } from "./entities";
import { SMS_PROVIDER } from "./sms-provider";
import { KavenegarSmsProvider } from "./kavenegar-sms.provider";

@Module({
  imports: [
    TypeOrmModule.forFeature([User, OtpChallenge, AuthSession]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>("ACCESS_TOKEN_SECRET"),
        signOptions: { algorithm: "HS256" as const },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthCryptoService,
    AuthTokenService,
    AuthenticationService,
    AccessTokenGuard,
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => config.get<string>("SMS_PROVIDER", "development") === "kavenegar" ? new KavenegarSmsProvider(config) : new DevelopmentSmsProvider(config),
    },
  ],
  exports: [AuthCryptoService, AuthTokenService, AccessTokenGuard, SMS_PROVIDER, JwtModule, TypeOrmModule],
})
export class AuthModule {}
