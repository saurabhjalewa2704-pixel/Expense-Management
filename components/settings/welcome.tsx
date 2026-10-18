"use client";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { completeOnboarding } from "@/app/actions/profile";
import { AccountEditor } from "@/components/accounts/account-editor";
import { accountIcon } from "@/components/accounts/accounts-screen";
import { accountTypeLabel } from "@/lib/accounts";
import { CategoryIcon, UI } from "@/lib/icons";
import { APP_NAME } from "@/lib/env";
import { formatGBP } from "@/lib/money";
import { useQueryClient } from "@tanstack/react-query";
import { todayLondon } from "@/lib/dates";
import { useAccounts, useBalances, useCategoryTree, useProfile } from "@/lib/queries/hooks";

/** AUTH-02: three steps, every one skippable except the first (at least one account). */
export function Welcome() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const { data: accounts } = useAccounts();
  const { data: balances } = useBalances(todayLondon());
  const { tree } = useCategoryTree();
  const [step, setStep] = useState(1);
  const [adding, setAdding] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [platform, setPlatform] = useState<"ios" | "installed" | "other">("other");
  const live = (accounts ?? []).filter((a) => !a.archived_at);

  useEffect(() => { if (profile?.onboarded_at) router.replace("/"); }, [profile, router]);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
    setPlatform(standalone ? "installed" : /iPhone|iPad|iPod/.test(navigator.userAgent) ? "ios" : "other");
  }, []);

  const finish = async () => {
    setFinishing(true);
    await completeOnboarding();
    await qc.invalidateQueries();
    router.replace("/");
  };

  return (
    <main className="mx-auto min-h-dvh max-w-[480px] px-5" style={{ paddingTop: "calc(var(--safe-top) + 12px)", paddingBottom: "calc(var(--safe-bottom) + 24px)" }}>
      <div className="eyebrow">{APP_NAME} · Step {step} of 3</div>
      <div style={{ display: "flex", gap: 6, margin: "12px 0 24px" }} aria-hidden>
        {[1, 2, 3].map((n) => <span key={n} style={{ flex: 1, height: 3, borderRadius: 2, background: n <= step ? "var(--ink)" : "var(--surface-3)" }} />)}
      </div>

      {step === 1 && (
        <section aria-labelledby="s1">
          <h1 id="s1" className="large-title">Your accounts</h1>
          <p className="callout muted" style={{ marginTop: 8 }}>Add what you spend from, with today&apos;s balance. Your available cash is worked out from these. Add savings too; they are kept apart by default.</p>
          {live.length > 0 && (
            <div className="list" style={{ marginTop: 20 }}>
              {live.map((a) => { const Icon = accountIcon(a.type); const b = balances?.find((x) => x.account_id === a.id)?.balance_pence; return (
                <div key={a.id} className="row" data-testid="onboarding-account"><div className="tile"><Icon size={20} strokeWidth={1.75} aria-hidden /></div>
                  <div className="row-main"><div className="row-t">{a.name}</div><div className="row-s">{accountTypeLabel(a.type)}{a.counts_as_cash ? "" : " · kept apart"}</div></div>
                  <div className="amt">{b === undefined ? "" : formatGBP(b)}</div></div>); })}
            </div>
          )}
          <button className="btn secondary" style={{ marginTop: 16 }} onClick={() => setAdding(true)}><UI.Plus size={18} strokeWidth={2} aria-hidden />{live.length ? "Add another account" : "Add an account"}</button>
          <button className="btn" style={{ marginTop: 12, opacity: live.length ? 1 : 0.4 }} disabled={live.length === 0} onClick={() => setStep(2)}>Continue</button>
        </section>
      )}

      {step === 2 && (
        <section aria-labelledby="s2">
          <h1 id="s2" className="large-title">Categories</h1>
          <p className="callout muted" style={{ marginTop: 8 }}>We&apos;ve set up {tree.parents("expense").length} categories for you, with sub-categories inside. Rename, add or hide them any time in Settings.</p>
          <div className="cat-grid" style={{ marginTop: 24 }}>
            {tree.parents("expense").map((p) => <div key={p.id} className="cat"><span className="sq"><CategoryIcon name={p.icon} size={24} /></span>{p.name}</div>)}
          </div>
          <button className="btn" style={{ marginTop: 28 }} onClick={() => setStep(3)}>Continue</button>
          <button className="btn secondary" style={{ marginTop: 10, height: 48 }} onClick={() => setStep(1)}>Back</button>
        </section>
      )}

      {step === 3 && (
        <section aria-labelledby="s3">
          <h1 id="s3" className="large-title">Keep it close</h1>
          <p className="callout muted" style={{ marginTop: 8 }}>{APP_NAME} works best from your Home Screen: it opens instantly, works offline and can remind you in the evening.</p>
          <div className="card" style={{ marginTop: 20 }}>
            {platform === "installed" ? (
              <div className="row-between"><span className="headline">Installed</span><UI.CircleCheck size={22} strokeWidth={1.75} className="pos" aria-hidden /></div>
            ) : platform === "ios" ? (
              <ol style={{ listStyle: "none", display: "grid", gap: 14, padding: 0 }}>
                <li style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="tile"><UI.Share size={20} strokeWidth={1.75} aria-hidden /></span><span>Tap <b>Share</b> in Safari&apos;s toolbar</span></li>
                <li style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="tile"><UI.SquarePlus size={20} strokeWidth={1.75} aria-hidden /></span><span>Choose <b>Add to Home Screen</b></span></li>
                <li style={{ display: "flex", gap: 12, alignItems: "center" }}><span className="tile"><UI.Check size={20} strokeWidth={1.75} aria-hidden /></span><span>Open {APP_NAME} from there</span></li>
              </ol>
            ) : (
              <p className="callout">Use your browser&apos;s menu to <b>Install app</b> or <b>Add to Home Screen</b>.</p>
            )}
          </div>
          <button className="btn" style={{ marginTop: 28, opacity: finishing ? 0.5 : 1 }} disabled={finishing} onClick={finish}>{finishing ? "Setting up…" : `Start using ${APP_NAME}`}</button>
          <button className="btn secondary" style={{ marginTop: 10, height: 48 }} onClick={() => setStep(2)}>Back</button>
        </section>
      )}
      <AccountEditor open={adding} onOpenChange={setAdding} />
    </main>
  );
}
