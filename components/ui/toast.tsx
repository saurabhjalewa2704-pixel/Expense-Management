"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

interface ToastInput {
  message: string;
  /** Shown as a button, e.g. "Undo". */
  action?: { label: string; onClick: () => void | Promise<void> };
  /** Milliseconds; defaults to 6 s (CAP-01). */
  duration?: number;
  tone?: "default" | "error";
}
interface ToastState extends ToastInput { id: number }

const Ctx = createContext<(t: ToastInput) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idRef = useRef(0);

  const dismiss = useCallback(() => { clearTimeout(timer.current); setToast(null); }, []);
  const show = useCallback((t: ToastInput) => {
    clearTimeout(timer.current);
    const id = ++idRef.current;
    setToast({ ...t, id });
    timer.current = setTimeout(() => setToast((cur) => (cur?.id === id ? null : cur)), t.duration ?? 6000);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" role="status" style={{ position: "fixed", left: 0, right: 0, bottom: "calc(var(--tabbar-h) + 12px)", zIndex: 60, display: "flex", justifyContent: "center", pointerEvents: "none", padding: "0 var(--gutter)" }}>
        {toast && (
          <div
            key={toast.id}
            style={{
              pointerEvents: "auto", display: "flex", alignItems: "center", gap: 12, background: "var(--surface-3)", color: "var(--ink)",
              borderRadius: 14, padding: "12px 12px 12px 16px", fontSize: "var(--t-callout)", fontWeight: 500, maxWidth: 420, width: "100%",
              boxShadow: "inset 0 0 0 1px var(--rule-strong), 0 8px 24px rgba(0,0,0,.4)",
              animation: "toast-in 220ms var(--spring)",
            }}
          >
            <span style={{ flex: 1, color: toast.tone === "error" ? "var(--caution)" : undefined }}>{toast.message}</span>
            {toast.action && (
              <button
                style={{ height: 32, padding: "0 12px", borderRadius: 999, background: "var(--ink)", color: "var(--on-ink)", fontWeight: 600, fontSize: "var(--t-sub)" }}
                onClick={async () => { const a = toast.action; dismiss(); await a?.onClick(); }}
              >
                {toast.action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}
