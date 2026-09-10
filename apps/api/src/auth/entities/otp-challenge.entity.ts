import { Check, Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from "typeorm";

export enum OtpPurpose {
  Login = "LOGIN",
  ClientLogin = "CLIENT_LOGIN",
}

export enum OtpChallengeStatus {
  Pending = "PENDING",
  Verified = "VERIFIED",
  Expired = "EXPIRED",
  Locked = "LOCKED",
  Cancelled = "CANCELLED",
}

@Entity({ name: "otp_challenges" })
@Index("IDX_otp_challenges_phone_created", ["phoneHash", "createdAt"])
@Index("IDX_otp_challenges_ip_created", ["requestedIpHash", "createdAt"])
@Index("IDX_otp_challenges_pending_expiry", ["expiresAt"], { where: "status = 'PENDING'" })
@Check("CK_otp_attempts", "attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts")
@Check("CK_otp_expiry", "expires_at > created_at")
export class OtpChallenge {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "phone_hash", type: "char", length: 64 })
  phoneHash!: string;

  @Column({ name: "coffee_shop_id", type: "uuid", nullable: true })
  coffeeShopId!: string | null;

  @Column({ name: "phone_ciphertext", type: "text", select: false })
  phoneCiphertext!: string;

  @Column({ name: "otp_hash", type: "char", length: 64, select: false })
  otpHash!: string;

  @Column({ type: "enum", enum: OtpPurpose, enumName: "otp_purpose", default: OtpPurpose.Login })
  purpose!: OtpPurpose;

  @Column({ type: "enum", enum: OtpChallengeStatus, enumName: "otp_challenge_status", default: OtpChallengeStatus.Pending })
  status!: OtpChallengeStatus;

  @Column({ type: "smallint", default: 0 })
  attempts!: number;

  @Column({ name: "max_attempts", type: "smallint", default: 5 })
  maxAttempts!: number;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @Column({ name: "resend_available_at", type: "timestamptz" })
  resendAvailableAt!: Date;

  @Column({ name: "requested_ip_hash", type: "char", length: 64, nullable: true })
  requestedIpHash!: string | null;

  @Column({ name: "requested_user_agent_hash", type: "char", length: 64, nullable: true })
  requestedUserAgentHash!: string | null;

  @Column({ name: "consumed_at", type: "timestamptz", nullable: true })
  consumedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
