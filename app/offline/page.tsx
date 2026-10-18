export const metadata = { title: "Offline" };

/** Shown when a page that has never been opened is requested with no connection. */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[420px] flex-col justify-center px-5">
      <div className="eyebrow">Sterling</div>
      <h1 className="large-title" style={{ marginTop: 8 }}>You&apos;re offline</h1>
      <p className="callout muted" style={{ marginTop: 8 }}>
        This page hasn&apos;t been opened on this device yet. Anything you&apos;ve logged is safe and will sync when you&apos;re back online.
      </p>
      <a className="btn" href="/" style={{ marginTop: 24 }}>Back to Home</a>
    </main>
  );
}
