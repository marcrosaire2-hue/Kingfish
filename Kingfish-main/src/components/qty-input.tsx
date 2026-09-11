"use client";

import { useEffect, useState } from "react";

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
  allowEmpty?: boolean;
  ariaLabel: string;
  placeholder?: string;
};

export function QtyInput({
  value,
  onChange,
  allowEmpty = false,
  ariaLabel,
  placeholder = "0",
}: Props) {
  const [draft, setDraft] = useState(
    value === null || value === undefined ? "" : String(value),
  );

  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  function commit(raw: string) {
    const cleaned = raw.replace(/\s/g, "").replace(",", ".");
    if (cleaned === "") {
      if (allowEmpty) {
        onChange(null);
        setDraft("");
        return;
      }
      onChange(0);
      setDraft("0");
      return;
    }
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n < 0) {
      setDraft(value === null || value === undefined ? "" : String(value));
      return;
    }
    const rounded = Math.round(n);
    onChange(rounded);
    setDraft(String(rounded));
  }

  return (
    <input
      className="qty-input"
      inputMode="numeric"
      aria-label={ariaLabel}
      value={draft}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => commit(draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
    />
  );
}
