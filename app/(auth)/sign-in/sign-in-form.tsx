"use client";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { requestCode, verifyCode } from "./actions";
import { APP_NAME } from "@/lib/env";

export function SignInForm({ next, initialError }: { next: string; initialError?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | undefined>(initialError);
  const [pending, start] = useTransition();
  const codeRef = useRef<HTMLInputElement>(null);

  const send = (e?: React.FormEvent) => {
    e?.preventDefault();
    setError(undefined);
    start(async () => {
      const r = await requestCode(email);
      if (!r.ok) return setError(r.error);
      setStep("code");
      setTimeout(() => codeRef.current?.focus(), 50);
    });
  };

  const verify = (value: string) => {
    setError(undefined);
    start(async () => {
      const r = await verifyCode(email, value);
      if (!r.ok) {
        setError(r.error);
        setCode("");
        return;
      }
      router.replace(next);
      router.refresh();
    });
  };

  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{APP_NAME}</div>
      <h1 className="large-title">{step === "email" ? "Sign in" : "Check your e-mail"}</h1>
      <p className="callout muted" style={{ marginTop: 8 }}>
        {step === "email" ? "We'll e-mail you a 6-digit code." : `Enter the 6-digit code we sent to ${email}.`}
      </p>

      {step === "email" ? (
        <form onSubmit={send} style={{ marginTop: 32 }} className="stack">
          <label className="sr-only" htmlFor="email">E-mail address</label>
          <input
            id="email" className="field w-full" type="email" inputMode="email" autoComplete="email" autoCapitalize="none"
            placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus
          />
          <button className="btn" type="submit" disabled={pending || !email} style={{ opacity: pending || !email ? 0.5 : 1 }}>
            {pending ? "Sending…" : "Send code"}
          </button>
        </form>
      ) : (
        <div style={{ marginTop: 32 }} className="stack">
          <label className="sr-only" htmlFor="code">6-digit code</label>
          <input
            id="code" ref={codeRef} className="field w-full" style={{ fontSize: 28, letterSpacing: "0.4em", textAlign: "center", height: 64 }}
            inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} placeholder="······"
            value={code}
            onChange={(e) => {
              const v = e.target.value.replace(/\D/g, "").slice(0, 6);
              setCode(v);
              if (v.length === 6) verify(v);
            }}
            aria-invalid={error ? true : undefined} aria-describedby={error ? "auth-error" : undefined}
          />
          <button className="btn secondary" type="button" disabled={pending} onClick={() => { setStep("email"); setCode(""); setError(undefined); }}>
            Use a different e-mail
          </button>
        </div>
      )}

      {error && <p id="auth-error" role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 16 }}>{error}</p>}
    </div>
  );
}
