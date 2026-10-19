"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { updateProfile } from "@/app/actions/profile";
import { UI } from "@/lib/icons";
import { enableReminders, pushSupport } from "@/lib/push";
import { useProfile, useTransactionCount } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";

/** One-time, in-context ask for the evening reminder after the 3rd logged transaction (PRD §6.11). Never on first launch. */
export function ReminderPrompt() {
  const profile = useProfile(), count = useTransactionCount();
  const qc = useQueryClient();
  const [support, setSupport] = useState<ReturnType<typeof pushSupport>>("unsupported");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  useEffect(() => setSupport(pushSupport()), []);
  const p = profile.data;
  if (!p || p.reminder_prompted || p.reminder_enabled || (count.data ?? 0) < 3 || support === "unsupported") return null;
  const done = async () => { await qc.invalidateQueries({ queryKey: qk.profile }); };
  return (
    <section className="card" data-testid="reminder-prompt" aria-label="Evening reminder" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div className="tile"><UI.Bell size={18} strokeWidth={1.75} aria-hidden /></div>
        <div style={{ flex: 1 }}>
          <div className="row-t">Get a gentle reminder at {p.reminder_time.slice(0, 5)} if you haven&rsquo;t logged anything?</div>
          <div className="row-s" style={{ marginTop: 4 }}>Only on days with nothing logged. Change the time or turn it off in Settings.</div>
        </div>
      </div>
      {error && <p role="alert" className="sub" style={{ marginTop: 10, color: "var(--caution)" }}>{error}</p>}
      <div className="ins-actions">
        <button className="ghost" onClick={async () => { await updateProfile({ reminder_prompted: true }); await done(); }}>Not now</button>
        <button className="ghost open" disabled={busy} onClick={async () => { setBusy(true); setError(undefined); const r = await enableReminders(); setBusy(false); if (!r.ok) { setError(r.error); return; } await done(); }}>Turn on</button>
      </div>
    </section>
  );
}
