import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectRepository } from "@nestjs/typeorm";
import { randomUUID } from "node:crypto";
import { DataSource, IsNull, MoreThan, Repository } from "typeorm";
import { CoffeeShopMembership, MembershipStatus, User, UserStatus } from "../identity/entities";
import { AuthCryptoService } from "./auth-crypto.service";
import { AuthTokenService } from "./auth-token.service";
import { AuthSession, OtpChallenge, OtpChallengeStatus, OtpPurpose } from "./entities";
import { normalizeIranianMobile } from "./iran-phone.util";
import { SMS_PROVIDER, SmsProvider } from "./sms-provider";

export interface RequestMetadata {
  ip?: string;
  userAgent?: string;
}

export interface AuthenticationResult {
  accessToken: string;
  accessTokenExpiresInSeconds: number;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  user: { id: string; phone: string };
}

@Injectable()
export class AuthenticationService {
  private readonly otpTtlSeconds: number;
  private readonly resendCooldownSeconds: number;
  private readonly maxAttempts: number;
  private readonly accessTokenTtlSeconds: number;
  private readonly phoneHourlyLimit: number;
  private readonly ipHourlyLimit: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(OtpChallenge) private readonly challenges: Repository<OtpChallenge>,
    @InjectRepository(AuthSession) private readonly sessions: Repository<AuthSession>,
    private readonly crypto: AuthCryptoService,
    private readonly tokens: AuthTokenService,
    private readonly config: ConfigService,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
  ) {
    this.otpTtlSeconds = config.getOrThrow<number>("OTP_TTL_SECONDS");
    this.resendCooldownSeconds = config.getOrThrow<number>("OTP_RESEND_COOLDOWN_SECONDS");
    this.maxAttempts = config.getOrThrow<number>("OTP_MAX_ATTEMPTS");
    this.accessTokenTtlSeconds = config.getOrThrow<number>("ACCESS_TOKEN_TTL_SECONDS");
    this.phoneHourlyLimit = config.getOrThrow<number>("OTP_PHONE_HOURLY_LIMIT");
    this.ipHourlyLimit = config.getOrThrow<number>("OTP_IP_HOURLY_LIMIT");
  }

  async requestOtp(rawPhone: string, metadata: RequestMetadata) {
    const phone = normalizeIranianMobile(rawPhone);
    const phoneHash = this.crypto.hashPhone(phone);
    const ipHash = metadata.ip ? this.crypto.hashFingerprint(metadata.ip) : null;
    const userAgentHash = metadata.userAgent ? this.crypto.hashFingerprint(metadata.userAgent) : null;
    const now = new Date();

    const cooldown = await this.challenges.findOne({
      where: { phoneHash, coffeeShopId: IsNull(), purpose: OtpPurpose.Login, status: OtpChallengeStatus.Pending, resendAvailableAt: MoreThan(now) },
      order: { createdAt: "DESC" },
    });
    if (cooldown) throw new HttpException("Please wait before requesting another code", HttpStatus.TOO_MANY_REQUESTS);

    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const phoneRequests = await this.challenges.count({ where: { phoneHash, createdAt: MoreThan(hourAgo) } });
    const ipRequests = ipHash ? await this.challenges.count({ where: { requestedIpHash: ipHash, createdAt: MoreThan(hourAgo) } }) : 0;
    if (phoneRequests >= this.phoneHourlyLimit || ipRequests >= this.ipHourlyLimit) {
      throw new HttpException("Too many verification requests", HttpStatus.TOO_MANY_REQUESTS);
    }

    const challengeId = randomUUID();
    const otp = this.crypto.generateOtp();
    const expiresAt = new Date(now.getTime() + this.otpTtlSeconds * 1000);
    const resendAvailableAt = new Date(now.getTime() + this.resendCooldownSeconds * 1000);

    await this.dataSource.transaction(async (manager) => {
      await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", [phoneHash]);
      if (ipHash) await manager.query("SELECT pg_advisory_xact_lock(hashtext($1))", ["ip:" + ipHash]);
      const lockedCooldown = await manager.findOne(OtpChallenge, {
        where: { phoneHash, coffeeShopId: IsNull(), purpose: OtpPurpose.Login, status: OtpChallengeStatus.Pending, resendAvailableAt: MoreThan(now) },
        order: { createdAt: "DESC" },
      });
      const lockedPhoneRequests = await manager.count(OtpChallenge, { where: { phoneHash, createdAt: MoreThan(hourAgo) } });
      const lockedIpRequests = ipHash ? await manager.count(OtpChallenge, { where: { requestedIpHash: ipHash, createdAt: MoreThan(hourAgo) } }) : 0;
      if (lockedCooldown || lockedPhoneRequests >= this.phoneHourlyLimit || lockedIpRequests >= this.ipHourlyLimit) {
        throw new HttpException("Please wait before requesting another code", HttpStatus.TOO_MANY_REQUESTS);
      }

      await manager.update(OtpChallenge, { phoneHash, coffeeShopId: IsNull(), purpose: OtpPurpose.Login, status: OtpChallengeStatus.Pending }, { status: OtpChallengeStatus.Cancelled });
      await manager.save(OtpChallenge, manager.create(OtpChallenge, {
        id: challengeId,
        coffeeShopId: null,
        phoneHash,
        phoneCiphertext: this.crypto.encryptPhone(phone),
        otpHash: this.crypto.hashOtp(challengeId, otp),
        purpose: OtpPurpose.Login,
        status: OtpChallengeStatus.Pending,
        attempts: 0,
        maxAttempts: this.maxAttempts,
        expiresAt,
        resendAvailableAt,
        requestedIpHash: ipHash,
        requestedUserAgentHash: userAgentHash,
      }));
    });

    try {
      await this.sms.sendOtp({ phone, otp, expiresInSeconds: this.otpTtlSeconds });
    } catch {
      await this.challenges.update({ id: challengeId }, { status: OtpChallengeStatus.Cancelled });
      throw new ServiceUnavailableException("Verification message could not be sent");
    }

    return { challengeId, expiresInSeconds: this.otpTtlSeconds, resendAfterSeconds: this.resendCooldownSeconds };
  }

  async verifyOtp(challengeId: string, otp: string, metadata: RequestMetadata): Promise<AuthenticationResult> {
    const refreshToken = this.crypto.generateRefreshToken();
    const now = new Date();

    const result = await this.dataSource.transaction(async (manager) => {
      const challenge = await manager.getRepository(OtpChallenge)
        .createQueryBuilder("challenge")
        .addSelect(["challenge.otpHash", "challenge.phoneCiphertext"])
        .setLock("pessimistic_write")
        .where("challenge.id = :challengeId", { challengeId })
        .getOne();

      if (!challenge || challenge.status !== OtpChallengeStatus.Pending) return { kind: "invalid" } as const;
      if (challenge.expiresAt <= now) {
        challenge.status = OtpChallengeStatus.Expired;
        await manager.save(challenge);
        return { kind: "invalid" } as const;
      }

      if (!this.crypto.verifyOtp(challenge.id, otp, challenge.otpHash)) {
        challenge.attempts += 1;
        if (challenge.attempts >= challenge.maxAttempts) challenge.status = OtpChallengeStatus.Locked;
        await manager.save(challenge);
        return { kind: "invalid" } as const;
      }

      challenge.status = OtpChallengeStatus.Verified;
      challenge.consumedAt = now;
      await manager.save(challenge);

      const phone = this.crypto.decryptPhone(challenge.phoneCiphertext);
      await manager.createQueryBuilder().insert().into(User).values({
        phone,
        phoneVerifiedAt: now,
        status: UserStatus.Active,
      }).orIgnore().execute();

      const user = await manager.findOneByOrFail(User, { phone });
      if (user.status !== UserStatus.Active) throw new ForbiddenException("User account is unavailable");
      if (!user.phoneVerifiedAt) {
        user.phoneVerifiedAt = now;
        await manager.save(user);
      }

      await manager.update(
        CoffeeShopMembership,
        { userId: user.id, status: MembershipStatus.Invited },
        { status: MembershipStatus.Active, acceptedAt: now },
      );

      const sessionId = randomUUID();
      const tokenFamilyId = randomUUID();
      const expiresAt = this.tokens.refreshTokenExpiresAt(now);
      await manager.save(AuthSession, manager.create(AuthSession, {
        id: sessionId,
        userId: user.id,
        tokenFamilyId,
        refreshTokenHash: this.crypto.hashRefreshToken(refreshToken),
        expiresAt,
        ipHash: metadata.ip ? this.crypto.hashFingerprint(metadata.ip) : null,
        userAgentHash: metadata.userAgent ? this.crypto.hashFingerprint(metadata.userAgent) : null,
      }));

      return { kind: "success", user, sessionId, expiresAt } as const;
    });

    if (result.kind === "invalid") throw new UnauthorizedException("Verification challenge is invalid or expired");

    return {
      accessToken: await this.tokens.issueAccessToken(result.user.id, result.sessionId),
      accessTokenExpiresInSeconds: this.accessTokenTtlSeconds,
      refreshToken,
      refreshTokenExpiresAt: result.expiresAt,
      user: { id: result.user.id, phone: result.user.phone! },
    };
  }

  async refresh(refreshToken: string, metadata: RequestMetadata): Promise<AuthenticationResult> {
    if (!refreshToken) throw new UnauthorizedException();
    const tokenHash = this.crypto.hashRefreshToken(refreshToken);
    const nextRefreshToken = this.crypto.generateRefreshToken();
    const now = new Date();

    const result = await this.dataSource.transaction(async (manager) => {
      const session = await manager.getRepository(AuthSession)
        .createQueryBuilder("session")
        .addSelect("session.refreshTokenHash")
        .setLock("pessimistic_write")
        .where("session.refresh_token_hash = :tokenHash", { tokenHash })
        .getOne();
      if (!session) throw new UnauthorizedException();

      if (session.rotatedAt || session.replacedBySessionId) {
        await manager.update(AuthSession, { tokenFamilyId: session.tokenFamilyId }, { revokedAt: now, compromisedAt: now });
        return { kind: "reuse" } as const;
      }
      if (session.revokedAt || session.expiresAt <= now) throw new UnauthorizedException();

      const user = await manager.findOneBy(User, { id: session.userId, status: UserStatus.Active, deletedAt: IsNull() });
      if (!user) throw new UnauthorizedException();

      const nextSessionId = randomUUID();
      const expiresAt = this.tokens.refreshTokenExpiresAt(now);
      await manager.save(AuthSession, manager.create(AuthSession, {
        id: nextSessionId,
        userId: session.userId,
        tokenFamilyId: session.tokenFamilyId,
        parentSessionId: session.id,
        refreshTokenHash: this.crypto.hashRefreshToken(nextRefreshToken),
        expiresAt,
        ipHash: metadata.ip ? this.crypto.hashFingerprint(metadata.ip) : null,
        userAgentHash: metadata.userAgent ? this.crypto.hashFingerprint(metadata.userAgent) : null,
      }));
      session.rotatedAt = now;
      session.revokedAt = now;
      session.lastUsedAt = now;
      session.replacedBySessionId = nextSessionId;
      await manager.save(session);

      return { kind: "success", user, sessionId: nextSessionId, expiresAt } as const;
    });

    if (result.kind === "reuse") throw new UnauthorizedException("Refresh token reuse detected");

    return {
      accessToken: await this.tokens.issueAccessToken(result.user.id, result.sessionId),
      accessTokenExpiresInSeconds: this.accessTokenTtlSeconds,
      refreshToken: nextRefreshToken,
      refreshTokenExpiresAt: result.expiresAt,
      user: { id: result.user.id, phone: result.user.phone! },
    };
  }

  async logout(refreshToken?: string): Promise<void> {
    if (!refreshToken) return;
    await this.sessions.update({ refreshTokenHash: this.crypto.hashRefreshToken(refreshToken), revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}
