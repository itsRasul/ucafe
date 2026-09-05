import { CreateBucketCommand, DeleteObjectsCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { Injectable, OnModuleInit, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Readable } from "node:stream";
import { MEDIA_VARIANTS, MediaVariant } from "./media-image.util";

@Injectable()
export class MediaStorageService implements OnModuleInit {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>("S3_BUCKET");
    this.client = new S3Client({
      endpoint: config.getOrThrow<string>("S3_ENDPOINT"),
      region: config.getOrThrow<string>("S3_REGION"),
      forcePathStyle: true,
      credentials: { accessKeyId: config.getOrThrow<string>("S3_ACCESS_KEY"), secretAccessKey: config.getOrThrow<string>("S3_SECRET_KEY") },
    });
  }

  async onModuleInit() {
    try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }
    catch {
      try { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })); }
      catch (error) { throw new ServiceUnavailableException("Media storage is unavailable", { cause: error }); }
    }
  }

  async readiness() { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })); }

  key(prefix: string, variant: MediaVariant) { return `${prefix}/${variant}.${variant.endsWith("avif") ? "avif" : "webp"}`; }

  async putVariants(prefix: string, variants: Record<MediaVariant, Buffer>) {
    await Promise.all(MEDIA_VARIANTS.map((variant) => this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: this.key(prefix, variant), Body: variants[variant], ContentType: variant.endsWith("avif") ? "image/avif" : "image/webp", CacheControl: "public, max-age=31536000, immutable" }))));
  }

  async get(prefix: string, variant: MediaVariant) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: this.key(prefix, variant) }));
    return { body: result.Body as Readable, contentLength: result.ContentLength, etag: result.ETag, contentType: result.ContentType ?? (variant.endsWith("avif") ? "image/avif" : "image/webp") };
  }

  async remove(prefix: string) {
    await this.client.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: MEDIA_VARIANTS.map((variant) => ({ Key: this.key(prefix, variant) })), Quiet: true } }));
  }
}
