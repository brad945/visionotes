import { useEffect, useRef } from "react";

/**
 * Accessible "are you sure?" modal. Renders nothing when `open` is false.
 * role=dialog + aria-modal, Esc / backdrop-click cancel, focuses the confirm
 * button on open. Styled with design tokens, so it works in light + dark.
 */
export default function ConfirmDialog({
  open,
  title = "Are you sure?",
  message,
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
  danger = true,
  busy = false,
  onConfirm,
  onCancel,
}) {
  const confirmRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Escape" && !busy) onCancel?.();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={() => !busy && onCancel?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        background: "rgba(0,0,0,0.45)",
      }}
    >
      <div
        className="vn-card"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 380, width: "100%", boxShadow: "var(--shadow-lift)" }}
      >
        <h2 style={{ fontSize: "1.1rem", marginBottom: 8 }}>{title}</h2>
        {message && (
          <p className="vn-muted" style={{ marginBottom: 18 }}>
            {message}
          </p>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" className="vn-btn vn-btn--ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            ref={confirmRef}
            className={`vn-btn ${danger ? "vn-btn--stop" : "vn-btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
