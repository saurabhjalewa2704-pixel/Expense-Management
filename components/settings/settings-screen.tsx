"use client";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signOut } from "@/app/(auth)/sign-in/actions";
import { updateProfile } from "@/app/actions/profile";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useAccounts, useCategories, useProfile } from "@/lib/queries/hooks";
import { APP_NAME } from "@/lib/env";
import { UI, type LucideIcon } from "@/lib/icons";
import { del } from "idb-keyval";

function Row({ href, Icon, title, sub }: { href: string; Icon: LucideIcon; title: string; sub?: string }) {
  return (
    <Link href={href} className="row">
      <div className="tile"><Icon size={20} strokeWidth={1.75} aria-hidden /></div>
      <div className="row-main"><div className="row-t">{title}</div>{sub && <div className="row-s">{sub}</div>}</div>
      <UI.ChevronRight size={18} strokeWidth={1.75} className="chev" aria-hidden />
    </Link>
  );
}

export function SettingsScreen() {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: profile } = useProfile();
  const accounts = (useAccounts().data ?? []).filter((a) => !a.archived_at);
  const categories = (useCategories().data ?? []).filter((c) => !c.archived_at && !c.parent_id);

  const doSignOut = async () => {
    await signOut();
    qc.clear();
    await del("sterling-query-cache").catch(() => {});
    router.replace("/sign-in");
    router.refresh();
  };

  return (
    <div className="scroll">
      <PageHeader title="Settings" back="/" backLabel="Home" />
      <div className="eyebrow group-label" style={{ marginTop: 24 }}>Money</div>
      <div className="list">
        <Row href="/settings/accounts" Icon={UI.Landmark} title="Accounts" sub={`${accounts.length} account${accounts.length === 1 ? "" : "s"}${accounts.find((a) => a.is_default) ? ` · default ${accounts.find((a) => a.is_default)!.name}` : ""}`} />
        <Row href="/settings/categories" Icon={UI.Tags} title="Categories" sub={`${categories.length} categories`} />
        <Row href="/bills" Icon={UI.Repeat} title="Bills" sub="Rent, subscriptions and anything that repeats, logged for you" />
        <Row href="/pots" Icon={UI.PiggyBank} title="One-off pots" sub="Big one-time costs, kept out of monthly spend" />
      </div>

      <div className="eyebrow group-label">Capture</div>
      <div className="list">
        <div className="row">
          <div className="row-main"><div className="row-t">Tap category to save</div><div className="row-s">With a remembered payee, tapping a category adds it</div></div>
          <Switch label="Tap category to save" checked={profile?.tap_to_save ?? true} onChange={async (v) => { await updateProfile({ tap_to_save: v }); await qc.invalidateQueries({ queryKey: ["profile"] }); }} />
        </div>
      </div>

      <div className="eyebrow group-label">Notifications and insights</div>
      <div className="list">
        <Row href="/settings/reminders" Icon={UI.Bell} title="Reminders" sub={profile?.reminder_enabled ? `Evening reminder at ${profile.reminder_time.slice(0, 5)}` : "Off"} />
        <Row href="/settings/ai" Icon={UI.Sparkles} title="AI insights" sub={profile?.ai_enabled === false ? "Off" : "On"} />
      </div>

      <div className="eyebrow group-label">Your data</div>
      <div className="list">
        <Row href="/settings/data" Icon={UI.Database} title="Export and delete" sub="CSV, JSON backup, erase everything" />
      </div>

      <div className="eyebrow group-label">Security</div>
      <div className="list">
        <button className="row" style={{ width: "100%", textAlign: "left" }} onClick={doSignOut}>
          <div className="tile"><UI.LogOut size={20} strokeWidth={1.75} aria-hidden /></div>
          <div className="row-main"><div className="row-t">Sign out</div><div className="row-s">Signs you out everywhere</div></div>
        </button>
      </div>
      <p className="sub" style={{ margin: "24px 16px 0", textAlign: "center" }}>{APP_NAME} · {profile?.display_name ?? "Signed in"}</p>
    </div>
  );
}
