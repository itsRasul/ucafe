import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";

@Injectable()
export class AuthCryptoService {
  private readonly pepper: Buffer;
  private readonly encryptionKey: Buffer;

  constructor(config: ConfigService) {
    this.pepper = Buffer.from(config.getOrThrow<string>("AUTH_PEPPER"), "utf8");
    this.encryptionKey = Buffer.from(config.getOrThrow<string>("PII_ENCRYPTION_KEY"), "base64");
    if (this.encryptionKey.length !== 32) throw new Error("PII_ENCRYPTION_KEY must decode to exactly 32 bytes");
  }

  generateOtp(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  hashOtp(challengeId: string, otp: string): string {
    return this.hmac(`otp:${challengeId}:${otp}`);
  }

  verifyOtp(challengeId: string, otp: string, expectedHash: string): boolean {
    return this.safeHexEqual(this.hashOtp(challengeId, otp), expectedHash);
  }

  hashPhone(phone: string): string {
    return this.hmac(`phone:${phone}`);
  }

  hashFingerprint(value: string): string {
    return this.hmac(`fingerprint:${value}`);
  }

  generateRefreshToken(): string {
    return randomBytes(32).toString("base64url");
  }

  hashRefreshToken(token: string): string {
    return this.hmac(`refresh:${token}`);
  }

  encryptPhone(phone: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(phone, "utf8"), cipher.final()]);
    return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
  }

  decryptPhone(value: string): string {
    const [version, ivValue, tagValue, encryptedValue] = value.split(".");
    if (version !== "v1" || !ivValue || !tagValue || !encryptedValue) throw new Error("Encrypted phone value is invalid");
    const decipher = createDecipheriv("aes-256-gcm", this.encryptionKey, Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedValue, "base64url")), decipher.final()]).toString("utf8");
  }

  private hmac(value: string): string {
    return createHmac("sha256", this.pepper).update(value, "utf8").digest("hex");
  }

  private safeHexEqual(actual: string, expected: string): boolean {
    if (!/^[a-f0-9]{64}$/i.test(expected)) return false;
    return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
  }
}
