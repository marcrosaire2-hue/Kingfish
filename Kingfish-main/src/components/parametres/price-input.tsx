"use client";

import { useEffect, useId, useState } from "react";
import { parseMoneyInput } from "@/lib/format";

type Props = {
  value: number | null;
  onChange: (value: number | null) => void;
  placeholder?: string;
  allowEmpty?: boolean;
  ariaLabel: string;
};

export function PriceInput({
  value,
  onChange,
  placeholder = "0",
  allowEmpty = false,
  ariaLabel,
}: Props) {
  const id = useId();
  const [draft, setDraft] = useState(
    value === null || value === undefined ? "" : String(value),
  );

  useEffect(() => {
    setDraft(value === null || value === undefined ? "" : String(value));
  }, [value]);

  function commit(raw: string) {
    const parsed = parseMoneyInput(raw);
    if (parsed === null) {
      if (allowEmpty) {
        onChange(null);
        setDraft("");
        return;
      }
      setDraft(value === null || value === undefined ? "" : String(value));
      return;
    }
    onChange(parsed);
    setDraft(String(parsed));
  }

  return (
    <div className="price-field">
      <input
        id={id}
        className="price-input"
        inputMode="numeric"
        aria-label={ariaLabel}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
      <span className="price-suffix" aria-hidden>
        F
      </span>
    </div>
  );
}
