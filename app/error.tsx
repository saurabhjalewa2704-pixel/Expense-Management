"use client";
import { del } from "idb-keyval";
import Link from "next/link";
import { useEffect } from "react";

const HEALED = "sterling-healed";

/** Forget what was cached on this device (it is all refetched; unsent entries live in a separate store and are untouched). */
const forgetCache = () => del("sterling-query-cache").catch(() => {});

/**
 * A crash inside a page shows this, in the app's own dark theme, instead of the framework's default page. The commonest cause is
 * data cached by an older version, so the first crash in a session clears the cache and reloads by itself; "Try again" does the same.
 */
export default function ErrorPage({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
    try {
      if (!sessionStorage.getItem(HEALED)) { sessionStorage.setItem(HEALED, "1"); void forgetCache().then(() => location.reload()); }
    } catch { /* private mode: leave the manual button */ }
  }, [error]);
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5">
      <div className="eyebrow">Sterling</div>
      <h1 className="large-title" style={{ marginTop: 8 }}>Something went wrong</h1>
      <p className="callout muted" style={{ marginTop: 8 }}>Your data is safe. Anything you logged is stored and will sync. Try again, or head back to Home.</p>
      <button className="btn" style={{ marginTop: 24 }} onClick={() => { void forgetCache().then(() => location.reload()); }}>Try again</button>
      <Link className="btn secondary" style={{ marginTop: 10, height: 48 }} href="/">Back to Home</Link>
    </main>
  );
}
