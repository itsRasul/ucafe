export const supportAttachmentMaxFiles = 5;
export const supportAttachmentMaxBytes = 8 * 1024 * 1024;
export const supportAttachmentTypes = ["image/jpeg", "image/png", "image/webp", "application/pdf"] as const;
export const supportAttachmentAccept = supportAttachmentTypes.join(",");

export type SupportAttachment = {
  id: string;
  originalFilename: string;
  detectedMimeType: (typeof supportAttachmentTypes)[number];
  sizeBytes: number;
  contentUrl: string;
};
export type AttachmentLoader = (path: string) => Promise<Blob>;

export function addSupportFiles(current: File[], selected: File[]) {
  if (current.length + selected.length > supportAttachmentMaxFiles) return { files: current, error: "حداکثر ۵ فایل می‌توانید ارسال کنید." };
  for (const file of selected) {
    if (file.size < 1 || file.size > supportAttachmentMaxBytes) return { files: current, error: "حجم هر فایل نباید بیشتر از ۸ مگابایت باشد." };
    if (!supportAttachmentTypes.includes(file.type as (typeof supportAttachmentTypes)[number])) return { files: current, error: "این نوع فایل پشتیبانی نمی‌شود." };
  }
  return { files: [...current, ...selected], error: "" };
}

export function removeSupportFile(files: File[], index: number) {
  return files.filter((_file, position) => position !== index);
}

export function supportMessageBody(fields: Record<string, string>, files: File[]): BodyInit {
  if (!files.length) return JSON.stringify(fields);
  const body = new FormData();
  for (const [name, value] of Object.entries(fields)) body.set(name, value);
  for (const file of files) body.append("files", file, file.name);
  return body;
}

export function formatSupportFileSize(sizeBytes: number) {
  const numbers = new Intl.NumberFormat("fa-IR", { maximumFractionDigits: 1 });
  return sizeBytes >= 1024 * 1024
    ? `${numbers.format(sizeBytes / (1024 * 1024))} مگابایت`
    : `${numbers.format(Math.max(1, Math.ceil(sizeBytes / 1024)))} کیلوبایت`;
}
