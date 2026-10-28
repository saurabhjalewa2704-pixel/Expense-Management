"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { createApiToken, revokeApiToken } from "@/app/actions/tokens";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { UI } from "@/lib/icons";
import { supabaseBrowser } from "@/lib/supabase/client";

interface TokenRow { id: string; name: string; created_at: string; last_used_at: string | null; revoked_at: string | null }

/** CAP-08: personal capture tokens for an iOS Shortcut. The token shows once; only its hash is kept. */
export function ShortcutsScreen() {
  const qc = useQueryClient();
  const toast = useToast();
  const [name, setName] = useState("");
  const [shown, setShown] = useState<string>();
  const [error, setError] = useState<string>();
  const tokens = useQuery({
    queryKey: ["api-tokens"],
    queryFn: async () => ((await supabaseBrowser().from("api_tokens").select("id,name,created_at,last_used_at,revoked_at").order("created_at", { ascending: false })).data ?? []) as TokenRow[],
  });
  const create = async () => {
    setError(undefined);
    const r = await createApiToken(name);
    if (!r.ok) return setError(r.error);
    setShown(r.data.token); setName("");
    await qc.invalidateQueries({ queryKey: ["api-tokens"] });
  };
  const revoke = async (id: string) => {
    const r = await revokeApiToken(id);
    if (!r.ok) return toast({ message: r.error, tone: "error" });
    await qc.invalidateQueries({ queryKey: ["api-tokens"] });
    toast({ message: "Token revoked. It stops working at once." });
  };
  return (
    <div className="scroll" data-testid="shortcuts">
      <PageHeader title="Shortcuts" back="/settings" backLabel="Settings" />
      <p className="sub" style={{ marginTop: 8 }}>Add an expense from an iOS Shortcut: send <code>POST /api/v1/capture</code> with your token and <code>{"{ amount, payee, category }"}</code>. Each token allows 60 a hour.</p>
      <div className="list" style={{ marginTop: 16 }}>
        <label className="row"><div className="row-main"><div className="row-t" style={{ fontWeight: 400 }}>Token name</div></div>
          <input aria-label="Token name" placeholder="iPhone Shortcut" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} style={{ background: "none", border: 0, outline: "none", textAlign: "right", color: "var(--ink)" }} /></label>
      </div>
      <button className="btn" style={{ marginTop: 12, opacity: name.trim() ? 1 : 0.4 }} disabled={!name.trim()} onClick={create} data-testid="token-create">Create token</button>
      {error && <p role="alert" className="callout" style={{ color: "var(--caution)", marginTop: 10 }}>{error}</p>}
      {shown && (
        <div className="card" style={{ marginTop: 12 }} data-testid="token-shown">
          <div className="headline">Copy it now. It won’t be shown again.</div>
          <code style={{ display: "block", marginTop: 8, wordBreak: "break-all", fontSize: 13 }} data-testid="token-value">{shown}</code>
        </div>
      )}
      <div className="section-h"><h2>Tokens</h2></div>
      <div className="list">
        {(tokens.data ?? []).map((t) => (
          <div key={t.id} className="row" data-testid="token-row">
            <div className="row-main"><div className="row-t">{t.name}</div><div className="row-s">{t.revoked_at ? "Revoked" : t.last_used_at ? "Used recently" : "Never used"}</div></div>
            {!t.revoked_at && <button className="chip plain" onClick={() => revoke(t.id)} aria-label={`Revoke ${t.name}`}><UI.X size={14} strokeWidth={2} aria-hidden />Revoke</button>}
          </div>
        ))}
        {tokens.data?.length === 0 && <div className="row"><div className="row-main sub">No tokens yet.</div></div>}
      </div>
    </div>
  );
}
