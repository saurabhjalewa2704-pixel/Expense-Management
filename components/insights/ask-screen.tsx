"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import { UI } from "@/lib/icons";
import type { AskTurn } from "@/lib/queries/fetchers";
import { useAskTurns, useProfile, usePots } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";

export const SUGGESTIONS = [
  "What did I spend on eating out last month?",
  "Compare this month with last month",
  "Where do I spend the most?",
  "Which day of the week do I spend the most?",
  "How much cash do I have?",
];

/** AI-04 "Ask Sterling": questions in plain English. Numbers come from SQL-backed tools and every figure in an answer is checked. */
export function AskScreen() {
  const qc = useQueryClient();
  const turns = useAskTurns();
  const profile = useProfile();
  const pots = usePots().data ?? [];
  const params = useSearchParams();
  const [input, setInput] = useState("");
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ q: string; message: string } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const autoAsked = useRef(false);
  const off = profile.data?.ai_enabled === false;

  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || asking) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return setProblem({ q, message: "You're offline. Questions need a connection." });
    setProblem(null); setAsking(q); setInput("");
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ question: q }) });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) setProblem({ q, message: body.error ?? "I couldn't answer that just now." });
      else await qc.invalidateQueries({ queryKey: qk.ask });
    } catch { setProblem({ q, message: "I couldn't reach the server. Check your connection and try again." }); }
    finally { setAsking(null); }
  };

  // a suggestion chip on the Insights screen arrives as /insights/ask?q=…
  useEffect(() => {
    const q = params.get("q");
    if (q && !autoAsked.current && !off) { autoAsked.current = true; void ask(q); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, off]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [turns.data?.length, asking, problem]);

  const list = turns.data ?? [];
  const suggestions = pots.length ? [...SUGGESTIONS.slice(0, 4), "How much has my home purchase cost so far?"] : SUGGESTIONS;
  return (
    <div className="scroll ask-scroll">
      <PageHeader title="Ask Sterling" back="/insights" backLabel="Insights" />
      <p className="sub" style={{ marginTop: 6 }}>Ask about your spending in your own words. Sterling looks up the numbers itself and checks every figure in the answer.</p>
      <div className="ask-thread" data-testid="ask-thread">
        {off && <p className="sub">AI is switched off. Turn it on in Settings → AI insights.</p>}
        {list.length === 0 && !asking && !problem && !off && (
          <div className="chips" style={{ marginTop: 8 }}>
            {suggestions.map((s) => <button key={s} className="chip soft plain" style={{ background: "var(--surface)", height: "auto", minHeight: 36, padding: "8px 14px", textAlign: "left" }} onClick={() => void ask(s)}>{s}</button>)}
          </div>
        )}
        {list.map((t) => <Turn key={t.id} t={t} />)}
        {asking && (<><div className="ask-q">{asking}</div><div className="card ask-a" aria-busy data-testid="ask-thinking"><span className="sub">Looking at your numbers…</span></div></>)}
        {problem && (<><div className="ask-q">{problem.q}</div><div className="card ask-a" role="alert" data-testid="ask-error"><span style={{ color: "var(--caution)" }}>{problem.message}</span></div></>)}
        <div ref={endRef} />
      </div>
      <form className="ask-dock" onSubmit={(e) => { e.preventDefault(); void ask(input); }}>
        <label className="field ask-field">
          <UI.Sparkles size={18} strokeWidth={1.75} className="faint" aria-hidden />
          <input aria-label="Ask about your money" placeholder="Ask about your money…" maxLength={500} value={input} onChange={(e) => setInput(e.target.value)} disabled={off} enterKeyHint="send" />
          <button type="submit" className="ask-send" aria-label="Send question" disabled={!input.trim() || !!asking || off}><UI.ArrowUp size={18} strokeWidth={2.25} aria-hidden /></button>
        </label>
      </form>
    </div>
  );
}

function Turn({ t }: { t: AskTurn }) {
  return (
    <>
      <div className="ask-q" data-testid="ask-question">{t.question}</div>
      <article className="card ask-a" data-testid="ask-answer" data-fallback={t.used_fallback ? "" : undefined}>
        <p style={{ whiteSpace: "pre-wrap" }}>{t.answer}</p>
        {t.facts.length > 0 && (
          <details className="ask-facts">
            <summary>Numbers used ({t.facts.length})</summary>
            <ul>{t.facts.map((f, i) => <li key={i}><span>{f.label}</span><b className="num">{f.display}</b></li>)}</ul>
          </details>
        )}
      </article>
    </>
  );
}

/** The docked entry on the Insights screen (mock-up 06): a field that opens the conversation, and starter questions. */
export function AskDock() {
  return (
    <div className="ask-dock" data-testid="ask-dock">
      <div className="chips nowrap" style={{ marginBottom: 10, overflowX: "auto", scrollbarWidth: "none" }}>
        {SUGGESTIONS.slice(0, 3).map((s) => <a key={s} href={`/insights/ask?q=${encodeURIComponent(s)}`} className="chip soft plain" style={{ background: "var(--surface)", flex: "none" }}>{s}</a>)}
      </div>
      <a href="/insights/ask" className="field ask-field" aria-label="Ask about your money">
        <UI.Sparkles size={18} strokeWidth={1.75} className="faint" aria-hidden />
        <span className="ph" style={{ flex: 1 }}>Ask about your money…</span>
        <span className="ask-send" aria-hidden><UI.ArrowUp size={18} strokeWidth={2.25} /></span>
      </a>
    </div>
  );
}
