"use client";

import { useEffect } from "react";

export function RegistreDrawer({
  open,
  onClose,
  title,
  subtitle,
  children,
  closeLabel = "Fermer le registre",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  closeLabel?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="drawer-root" role="presentation">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label={closeLabel}
        onClick={onClose}
      />
      <aside
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <header className="drawer-header">
          <div>
            <h2 className="drawer-title">{title}</h2>
            {subtitle ? <p className="drawer-subtitle">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fermer
          </button>
        </header>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}
