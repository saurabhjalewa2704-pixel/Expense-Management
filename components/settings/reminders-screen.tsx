"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { updateProfile } from "@/app/actions/profile";
import { PageHeader } from "@/components/ui/page-header";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/toast";
import { addDays, weekdayIndex } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { REMINDER_SLOTS } from "@/lib/nudge";
import { disableReminders, enableReminders, pushSupport, type PushSupport } from "@/lib/push";
import { useProfile, useToday, useWeekActivity } from "@/lib/queries/hooks";
import { qk } from "@/lib/queries/keys";

const DAYS = ["M", "T", "W", "T", "F", "S", "S"];
const NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WORDS = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven"];

/** SET-07 / NOT-01 (mock-up 12): on/off, time in 15-minute steps, and the week at a glance. */
export function RemindersScreen() {
  const profile = useProfile();
  const today = useToday();
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const [support, setSupport] = useState<PushSupport>("ready");
  const [denied, setDenied] = useState(false);
  useEffect(() => { setSupport(pushSupport()); setDenied(typeof Notification !== "undefined" && Notification.permission === "denied"); }, []);
  const monday = addDays(today, -weekdayIndex(today));
  const week = useWeekActivity(monday, addDays(monday, 6));
  const on = profile.data?.reminder_enabled ?? false;
  const time = (profile.data?.reminder_time ?? "21:00:00").slice(0, 5);
  const refresh = () => qc.invalidateQueries({ queryKey: qk.profile });

  async function toggle(v: boolean) {
    setBusy(true); setProblem(undefined);
    const r = v ? await enableReminders() : await disableReminders();
    setBusy(false);
    if (!r.ok) setProblem(r.error);
    await refresh();
  }
  async function pick(t: string) {
    const r = await updateProfile({ reminder_time: t });
    if (!r.ok) toast({ message: r.error, tone: "error" });
    await refresh();
  }

  const logged = new Set(week.data?.logged), noSpend = new Set(week.data?.noSpend);
  const idx = weekdayIndex(today);
  const days = DAYS.map((l, i) => { const d = addDays(monday, i); return { l, d, i, state: noSpend.has(d) && !logged.has(d) ? "none" : logged.has(d) ? "logged" : "open", past: i < idx, today: i === idx, future: i > idx }; });
  const counted = days.filter((x) => !x.future && x.state !== "open").length;
  const marked = days.filter((x) => x.state === "none");

  return (
    <div className="scroll">
      <PageHeader title="Reminders" back="/settings" backLabel="Settings" />
      <div className="list" style={{ marginTop: 20 }}>
        <div className="row"><div className="tile"><UI.Bell size={18} strokeWidth={1.75} aria-hidden /></div>
          <div className="row-main"><div className="row-t">Evening reminder</div><div className="row-s" data-testid="reminder-sub">{denied ? "Off in iPhone Settings" : "Only if nothing’s logged that day"}</div></div>
          <Switch label="Evening reminder" checked={on} disabled={busy || support !== "ready" || (denied && !on)} onChange={toggle} /></div>
        {on && (
          <div className="row" style={{ flexWrap: "wrap", rowGap: 12 }}>
            <div className="tile"><UI.Clock size={18} strokeWidth={1.75} aria-hidden /></div>
            <div className="row-main"><div className="row-t">Time</div><div className="row-s">London time</div></div>
            <span className="num" data-testid="reminder-time" style={{ fontSize: 16, fontWeight: 500 }}>{time}</span>
            <div className="chips" role="radiogroup" aria-label="Reminder time" style={{ width: "100%", paddingLeft: 48, gap: 6, flexWrap: "nowrap", overflowX: "auto", scrollbarWidth: "none" }}>
              {REMINDER_SLOTS.map((t) => (
                <button key={t} role="radio" aria-checked={t === time} className={`chip plain num${t === time ? " sel" : ""}`} style={{ height: 34, padding: "0 12px", flex: "none" }} onClick={() => pick(t)}>{t}</button>
              ))}
            </div>
          </div>
        )}
      </div>
      {support === "needs-install" && (
        <div className="card" style={{ marginTop: 12 }} data-testid="install-card">
          <div className="headline">Install Sterling to get reminders</div>
          <p className="sub" style={{ marginTop: 4 }}>On iPhone, reminders only work from the Home Screen. Tap Share, then Add to Home Screen, and open Sterling from there.</p>
        </div>
      )}
      {denied && support === "ready" && (
        <div className="card" style={{ marginTop: 12 }} data-testid="denied-card">
          <div className="headline">Notifications are off for Sterling</div>
          <p className="sub" style={{ marginTop: 4 }}>Open Settings → Notifications → Sterling and allow notifications, then come back and turn the reminder on. Sterling won’t ask again.</p>
        </div>
      )}
      {problem && <p role="alert" className="sub" style={{ margin: "10px 16px 0", color: "var(--caution)" }}>{problem}</p>}

      <div className="eyebrow group-label">This week</div>
      <div className="card" data-testid="week" style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 6, textAlign: "center" }}>
        {days.map((x) => (
          <div key={x.d} style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "center" }}>
            <span className="sub" style={{ fontSize: 12 }}>{x.l}</span>
            <span data-state={x.state} aria-label={`${NAMES[x.i]}: ${x.state === "logged" ? "logged" : x.state === "none" ? "nothing to log" : x.future ? "upcoming" : x.today ? "today, nothing yet" : "nothing logged"}`}
              style={{ width: 30, height: 30, borderRadius: "50%", display: "grid", placeItems: "center", ...(x.state === "logged" ? { background: "var(--ink)", color: "var(--on-ink)" } : x.state === "none" ? { boxShadow: "inset 0 0 0 1.5px var(--ink-3)", color: "var(--ink-2)" } : x.today ? { boxShadow: "inset 0 0 0 1.5px var(--ink)", color: "var(--ink)" } : { background: "var(--surface-2)", color: "var(--ink-3)", opacity: x.future ? 0.5 : 1 }) }}>
              {x.state === "logged" ? <UI.Check size={14} strokeWidth={2.5} aria-hidden /> : x.state === "none" ? <span style={{ fontSize: 11, fontWeight: 600 }}>0</span> : x.today ? <span style={{ fontSize: 11, fontWeight: 600 }}>{Number(x.d.slice(8))}</span> : null}
            </span>
          </div>
        ))}
      </div>
      <p className="sub" data-testid="week-summary" style={{ margin: "10px 16px 0", lineHeight: 1.45 }}>
        {WORDS[counted]} {counted === 1 ? "day" : "days"} logged.{marked.length > 0 && ` ${marked.map((m) => NAMES[m.i]).join(" and ")} ${marked.length > 1 ? "were" : "was"} marked “Nothing to log”, so ${marked.length > 1 ? "they count" : "it counts"} as a genuine no-spend day${marked.length > 1 ? "s" : ""}.`}
      </p>

      <div className="eyebrow group-label">Bills</div>
      <div className="list">
        <div className="row"><div className="tile"><UI.Calendar size={18} strokeWidth={1.75} aria-hidden /></div><div className="row-main"><div className="row-t">Bills logged and due</div><div className="row-s">{on ? "A summary at 6am, estimates to confirm, and reminders" : "Turn the evening reminder on once to register this device"}</div></div>
          <Switch label="Bills logged and due" checked={profile.data?.bills_notify ?? true} onChange={async (v) => { await updateProfile({ bills_notify: v }); await refresh(); }} /></div>
      </div>

      <div className="eyebrow group-label">Trips</div>
      <div className="list">
        <div className="row"><div className="tile"><UI.Plane size={18} strokeWidth={1.75} aria-hidden /></div><div className="row-main"><div className="row-t">Trip wrap-up ready</div><div className="row-s">{on ? "The morning after a trip ends" : "Turn the evening reminder on once to register this device"}</div></div>
          <Switch label="Trip wrap-up ready" checked={profile.data?.trip_notify ?? true} onChange={async (v) => { await updateProfile({ trip_notify: v }); await refresh(); }} /></div>
      </div>

      <div className="eyebrow group-label">Coming in v1.1</div>
      <div className="list">
        <div className="row"><div className="tile"><UI.Sparkles size={18} strokeWidth={1.75} aria-hidden /></div><div className="row-main"><div className="row-t">Weekly insights ready</div><div className="row-s">Mondays at 07:00</div></div><Switch label="Weekly insights ready" checked={false} disabled onChange={() => {}} /></div>
      </div>
    </div>
  );
}
