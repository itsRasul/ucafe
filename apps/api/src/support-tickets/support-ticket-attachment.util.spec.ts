import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { detectSupportTicketAttachmentType, inspectSupportTicketAttachments, MAX_SUPPORT_TICKET_ATTACHMENT_BYTES, MAX_SUPPORT_TICKET_ATTACHMENTS, sanitizeAttachmentFilename } from "./support-ticket-attachment.util";

const pdf = Buffer.from("%PDF-1.7\ncontent");
const file = (buffer = pdf, originalname = "support.pdf", mimetype = "application/octet-stream") => ({ buffer, originalname, mimetype, size: buffer.length }) as Express.Multer.File;

test("attachment detection uses content signatures and filename sanitization drops path/control data", () => {
  assert.equal(detectSupportTicketAttachmentType(pdf), "application/pdf");
  assert.equal(detectSupportTicketAttachmentType(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(detectSupportTicketAttachmentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  assert.equal(detectSupportTicketAttachmentType(Buffer.from("RIFF\0\0\0\0WEBP")), "image/webp");
  assert.equal(detectSupportTicketAttachmentType(Buffer.from("<html>")), undefined);
  assert.equal(sanitizeAttachmentFilename("..\\folder\\report\r\n.pdf"), "report.pdf");
});

test("attachment inspection accepts detected PDF content without trusting the browser MIME", async () => {
  assert.deepEqual(await inspectSupportTicketAttachments([file(pdf, "report.pdf")]), [{
    originalFilename: "report.pdf", detectedMimeType: "application/pdf", sizeBytes: pdf.length,
  }]);
  await assert.rejects(inspectSupportTicketAttachments([file(Buffer.from("MZ executable"), "photo.jpg", "image/jpeg")]), BadRequestException);
});

test("attachment inspection enforces server-side file count and byte limits", async () => {
  assert.equal(MAX_SUPPORT_TICKET_ATTACHMENTS, 5);
  await assert.rejects(inspectSupportTicketAttachments(Array.from({ length: 6 }, () => file())), BadRequestException);
  await assert.rejects(inspectSupportTicketAttachments([file(Buffer.alloc(MAX_SUPPORT_TICKET_ATTACHMENT_BYTES + 1, 0x20))]), BadRequestException);
});
