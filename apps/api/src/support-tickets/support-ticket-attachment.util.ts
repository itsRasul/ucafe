import { BadRequestException } from "@nestjs/common";
import sharp from "sharp";
import { MAX_MEDIA_PIXELS } from "../media/media-image.util";

export const MAX_SUPPORT_TICKET_ATTACHMENTS = 5;
export const MAX_SUPPORT_TICKET_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const SUPPORT_TICKET_ATTACHMENT_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export type SupportTicketAttachmentMimeType = (typeof SUPPORT_TICKET_ATTACHMENT_TYPES)[number];

export function sanitizeAttachmentFilename(value: string) {
  const name = value.replaceAll("\\", "/").split("/").at(-1)?.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180);
  return name || "attachment";
}

export function detectSupportTicketAttachmentType(bytes: Buffer): SupportTicketAttachmentMimeType | undefined {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (bytes.length >= 5 && bytes.toString("ascii", 0, 5) === "%PDF-") return "application/pdf";
}

export async function inspectSupportTicketAttachments(files: Express.Multer.File[] = []) {
  if (files.length > MAX_SUPPORT_TICKET_ATTACHMENTS) throw new BadRequestException("At most five files may be attached to a message");
  const inspected: Array<{ originalFilename: string; detectedMimeType: SupportTicketAttachmentMimeType; sizeBytes: number }> = [];
  for (const file of files) {
    const sizeBytes = file.buffer?.byteLength ?? 0;
    if (!sizeBytes || sizeBytes > MAX_SUPPORT_TICKET_ATTACHMENT_BYTES) throw new BadRequestException("Each attachment must be between 1 byte and 8 MB");
    const detectedMimeType = detectSupportTicketAttachmentType(file.buffer);
    if (!detectedMimeType) throw new BadRequestException("Only JPEG, PNG, WebP, and PDF attachments are accepted");
    if (detectedMimeType.startsWith("image/")) {
      try {
        const metadata = await sharp(file.buffer, { limitInputPixels: MAX_MEDIA_PIXELS, failOn: "warning" }).metadata();
        const expectedFormat = detectedMimeType === "image/jpeg" ? "jpeg" : detectedMimeType.slice("image/".length);
        if (metadata.format !== expectedFormat || !metadata.width || !metadata.height || metadata.width * metadata.height > MAX_MEDIA_PIXELS) throw new Error("Image signature mismatch");
      } catch {
        throw new BadRequestException("Image data is invalid or exceeds the pixel limit");
      }
    }
    inspected.push({ originalFilename: sanitizeAttachmentFilename(file.originalname), detectedMimeType, sizeBytes });
  }
  return inspected;
}

export function attachmentContentDisposition(filename: string) {
  const safeFilename = sanitizeAttachmentFilename(filename);
  const fallback = safeFilename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_") || "attachment";
  const encoded = encodeURIComponent(safeFilename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
