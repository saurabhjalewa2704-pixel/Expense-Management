"use client";
import { useEffect } from "react";

/** A crash inside a page shows this, in the app's own dark theme, instead of the framework's default page. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5">
      <div className="eyebrow">Sterling</div>
      <h1 className="large-title" style={{ marginTop: 8 }}>Something went wrong</h1>
      <p className="callout muted" style={{ marginTop: 8 }}>Your data is safe. Anything you logged is stored and will sync. Try again, or head back to Home.</p>
      <button className="btn" style={{ marginTop: 24 }} onClick={reset}>Try again</button>
      <a className="btn secondary" style={{ marginTop: 10, height: 48 }} href="/">Back to Home</a>
    </main>
  );
}
