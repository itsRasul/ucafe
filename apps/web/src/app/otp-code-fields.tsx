"use client";

import { ClipboardEvent, KeyboardEvent, useRef } from "react";

export function normalizeOtpDigits(value: string) {
  return value
    .replace(/[\u06F0-\u06F9]/g, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/\D/g, "");
}

export function OtpCodeFields({ value, onChange, onComplete, disabled, className = "auth-otp-inputs" }: { value: string[]; onChange: (value: string[]) => void; onComplete: (value: string) => void; disabled: boolean; className?: string }) {
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  function applyDigits(startIndex: number, rawValue: string) {
    const incoming = normalizeOtpDigits(rawValue);
    if (!incoming) return;
    const next = [...value];
    incoming.slice(0, 6 - startIndex).split("").forEach((digit, offset) => { next[startIndex + offset] = digit; });
    const code = next.join("");
    onChange(next);
    const nextEmpty = next.findIndex((digit, index) => index >= startIndex && !digit);
    inputRefs.current[nextEmpty === -1 ? 5 : nextEmpty]?.focus();
    if (next.every(Boolean)) onComplete(code);
  }

  function handleKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Backspace" && !value[index] && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowLeft" && index > 0) inputRefs.current[index - 1]?.focus();
    if (event.key === "ArrowRight" && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    const pasted = normalizeOtpDigits(event.clipboardData.getData("text")).slice(0, 6);
    if (!pasted) return;
    event.preventDefault();
    applyDigits(0, pasted);
  }

  return <div className={className} dir="ltr" onPaste={handlePaste}>
    {value.map((digit, index) => <input
      key={index}
      ref={(element) => { inputRefs.current[index] = element; }}
      type="text"
      inputMode="numeric"
      autoComplete={index === 0 ? "one-time-code" : "off"}
      pattern="[0-9]"
      maxLength={1}
      value={digit}
      aria-label={`رقم ${index + 1} از ۶`}
      disabled={disabled}
      autoFocus={index === 0}
      onFocus={(event) => event.currentTarget.select()}
      onKeyDown={(event) => handleKeyDown(index, event)}
      onChange={(event) => {
        const incoming = normalizeOtpDigits(event.target.value);
        if (incoming.length > 1) { applyDigits(index, incoming); return; }
        const next = [...value];
        next[index] = incoming.slice(-1);
        const code = next.join("");
        onChange(next);
        if (next[index] && index < 5) inputRefs.current[index + 1]?.focus();
        if (next.every(Boolean)) onComplete(code);
      }}
    />)}
  </div>;
}
