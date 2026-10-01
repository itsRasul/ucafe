"use client";

import { useEffect, useRef, useState } from "react";
import { addSupportFiles, formatSupportFileSize, removeSupportFile, supportAttachmentAccept } from "./support-attachment-model";
import type { AttachmentLoader, SupportAttachment } from "./support-attachment-model";

export function SupportFilePicker({ files, onChange, disabled = false }: { files: File[]; onChange: (files: File[]) => void; disabled?: boolean }) {
  const [error, setError] = useState("");
  return <div className="support-attachment-picker">
    <label className="support-attachment-picker-label">افزودن پیوست
      <input type="file" multiple accept={supportAttachmentAccept} disabled={disabled} onChange={(event) => {
        const result = addSupportFiles(files, Array.from(event.currentTarget.files ?? []));
        onChange(result.files);
        setError(result.error);
        event.currentTarget.value = "";
      }} />
    </label>
    <small>حداکثر ۵ فایل · هر فایل تا ۸ مگابایت · JPEG، PNG، WebP یا PDF</small>
    {error && <p className="support-attachment-error" role="alert">{error}</p>}
    {files.length > 0 && <ul className="support-attachment-list" aria-label="فایل‌های انتخاب‌شده">
      {files.map((file, index) => <li className="support-attachment-card support-attachment-card--pending" key={`${file.name}-${file.size}-${file.lastModified}-${index}`}>
        <FileGlyph image={file.type.startsWith("image/")} />
        <span className="support-attachment-copy"><strong dir="auto">{file.name}</strong><small>{formatSupportFileSize(file.size)}</small></span>
        <button type="button" className="support-attachment-action" disabled={disabled} aria-label={`حذف پیوست ${file.name}`} onClick={() => { onChange(removeSupportFile(files, index)); setError(""); }}>حذف</button>
      </li>)}
    </ul>}
  </div>;
}

export function SupportMessageAttachments({ attachments, loadBlob }: { attachments?: SupportAttachment[]; loadBlob: AttachmentLoader }) {
  if (!attachments?.length) return null;
  return <ul className="support-attachment-list" aria-label="پیوست‌های پیام">
    {attachments.map((attachment) => <TicketAttachmentCard key={attachment.id} attachment={attachment} loadBlob={loadBlob} />)}
  </ul>;
}

function TicketAttachmentCard({ attachment, loadBlob }: { attachment: SupportAttachment; loadBlob: AttachmentLoader }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const previewUrl = useRef("");
  const image = attachment.detectedMimeType.startsWith("image/");

  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);

  async function openAttachment(mode: "preview" | "download") {
    setBusy(true);
    setError("");
    try {
      const url = URL.createObjectURL(await loadBlob(attachment.contentUrl));
      if (mode === "preview" && image) {
        if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
        previewUrl.current = url;
        setPreview(url);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = attachment.originalFilename;
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch {
      setError("دریافت پیوست انجام نشد. دوباره تلاش کنید.");
    } finally { setBusy(false); }
  }

  function closePreview() {
    if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
    previewUrl.current = "";
    setPreview("");
  }

  return <li className="support-attachment-card">
    <FileGlyph image={image} />
    <span className="support-attachment-copy"><strong dir="auto">{attachment.originalFilename}</strong><small>{image ? "تصویر" : "PDF"} · {formatSupportFileSize(attachment.sizeBytes)}</small></span>
    <span className="support-attachment-actions">
      {image && (preview
        ? <button type="button" className="support-attachment-action" onClick={closePreview}>بستن پیش‌نمایش</button>
        : <button type="button" className="support-attachment-action" disabled={busy} onClick={() => void openAttachment("preview")}>{busy ? "در حال دریافت…" : "پیش‌نمایش"}</button>)}
      <button type="button" className="support-attachment-action" disabled={busy} onClick={() => void openAttachment("download")}>{busy ? "در حال دریافت…" : "دانلود"}</button>
    </span>
    {error && <small className="support-attachment-error" role="alert">{error}</small>}
    {preview && <img className="support-attachment-preview" src={preview} alt={`پیش‌نمایش ${attachment.originalFilename}`} />}
  </li>;
}

function FileGlyph({ image }: { image: boolean }) {
  return <span className={`support-attachment-glyph${image ? " is-image" : " is-document"}`} aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none"><path d={image ? "M4 5.5h16v13H4zM7.5 9h.01M4.5 16l4.5-4 3.2 2.8 2.4-2 5 4.2" : "M6 2.75h8l4 4v14.5H6zM14 2.75v4h4M9 12h6M9 15h6M9 18h4"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
  </span>;
}
