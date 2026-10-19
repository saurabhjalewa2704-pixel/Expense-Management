"use client";

/** The last resort when the root layout itself fails: it must bring its own <html>, so it carries the dark ground inline. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en-GB" style={{ colorScheme: "dark", background: "#0C0D0C" }}>
      <body style={{ margin: 0, background: "#0C0D0C", color: "#F3F2EE", fontFamily: "system-ui, sans-serif", minHeight: "100dvh", display: "grid", placeItems: "center", padding: 20 }}>
        <div style={{ maxWidth: 380 }}>
          <h1 style={{ fontSize: 28, margin: 0 }}>Something went wrong</h1>
          <p style={{ color: "#A9AAA4", lineHeight: 1.4 }}>Your data is safe. Try again.</p>
          <button onClick={reset} style={{ height: 52, width: "100%", borderRadius: 16, border: 0, background: "#F3F2EE", color: "#0C0D0C", fontSize: 17, fontWeight: 600 }}>Try again</button>
        </div>
      </body>
    </html>
  );
}
