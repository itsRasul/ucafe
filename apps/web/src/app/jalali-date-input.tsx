"use client";

import { useEffect, useRef } from "react";
import { formatJalaliDateAscii, jalaliToIsoDate } from "./jalali-date";

export function JalaliDateInput({ value, onChange, min, max, required = false }: { value: string; onChange: (value: string) => void; min?: string; max?: string; required?: boolean }) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    const sync = () => onChange(jalaliToIsoDate(input.value));
    input.addEventListener("jdp:change", sync);
    return () => input.removeEventListener("jdp:change", sync);
  }, [onChange]);

  return <input ref={inputRef} data-jdp data-jdp-only-date data-jdp-min-date={min ? formatJalaliDateAscii(min) : undefined} data-jdp-max-date={max ? formatJalaliDateAscii(max) : undefined} inputMode="none" placeholder="1405/06/15" value={value ? formatJalaliDateAscii(value) : ""} onChange={(event) => onChange(jalaliToIsoDate(event.target.value))} required={required} />;
}
