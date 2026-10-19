"use client";

/** An iOS-style switch. On = ink track, so colour keeps its meaning (green is income, amber is "look at this"). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}
      style={{ width: 51, height: 31, borderRadius: 999, padding: 2, flex: "none", background: checked ? "var(--ink)" : "var(--surface-3)", transition: "background 160ms ease", opacity: disabled ? 0.5 : 1, display: "flex" }}
    >
      <span style={{ width: 27, height: 27, borderRadius: "50%", background: checked ? "var(--on-ink)" : "var(--ink-2)", transform: `translateX(${checked ? 20 : 0}px)`, transition: "transform 200ms var(--spring)" }} />
    </button>
  );
}
