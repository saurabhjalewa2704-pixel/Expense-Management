"use client";
import Link from "next/link";
import { TxnItem, recentWhen } from "@/components/activity/txn-row";
import { useQuickAdd } from "@/components/capture/quick-add";
import { Figure, cashLabel } from "@/components/money";
import { ReminderPrompt } from "@/components/home/reminder-prompt";
import { PotsSection } from "@/components/home/pots-section";
import { BillsCard } from "@/components/home/bills-card";
import { TripCard } from "@/components/home/trip-card";
import { InsightCard } from "@/components/insights/insight-card";
import { formatLong, formatMonth, addMonths, monthStart } from "@/lib/dates";
import { UI } from "@/lib/icons";
import { formatGBP } from "@/lib/money";
import { useMonthFlow, usePace, useProfile, useRecent } from "@/lib/queries/hooks";
import { useAnimatedNumber } from "@/lib/use-animated-number";
import { useIsDesktop } from "@/lib/use-media";
import { DesktopHome } from "./desktop-home";
import { rowSubtitle } from "@/lib/categories";

/** Phone and tablet get the stacked Home; from 1024px the dashboard (S10) takes over. */
export function HomeScreen() {
  const desktop = useIsDesktop();
  return desktop ? <DesktopHome /> : <MobileHome />;
}

function MobileHome() {
  const { today, data: flow } = useMonthFlow();
  const { data: pace } = usePace();
  const { data: profile } = useProfile();
  const { rows: recent, isLoading: recentLoading } = useRecent(4);
  const { open } = useQuickAdd();
  const cash = useAnimatedNumber(flow?.closing_pence);
  const initial = (profile?.display_name?.trim()[0] ?? "S").toUpperCase();

  return (
    <div className="scroll">
      <div className="topbar">
        <span className="eyebrow" suppressHydrationWarning>{formatLong(today)}</span>
        <Link href="/settings" className="avatar" aria-label="Settings">{initial}</Link>
      </div>

      <section className="hero" style={{ marginTop: 20 }} aria-label="Available cash">
        <Link href="/cash" className="hero-label" aria-label="Available cash, see the detail">
          {cashLabel(cash)} <UI.ChevronRight size={16} strokeWidth={1.75} className="chev" aria-hidden />
        </Link>
        {cash === undefined ? (
          <div className="skeleton" style={{ height: 64, width: 260, marginTop: 10 }} aria-busy />
        ) : (
          <Link href="/cash" aria-label={`Available cash ${formatGBP(flow?.closing_pence ?? 0)}`} data-testid="hero"><Figure pence={cash} /></Link>
        )}
        {flow ? (
          <div className="equation" data-testid="equation">
            <Term k="Opening" v={formatGBP(flow.opening_pence)} />
            <Pair op="+"><Term k="In" v={formatGBP(flow.income_pence)} pos /></Pair>
            <Pair op="−"><Term k="Out" v={formatGBP(flow.spend_pence)} /></Pair>
            {!!flow.pot_pence && <Pair op={flow.pot_pence < 0 ? "−" : "+"}><Term k="One-off" v={formatGBP(Math.abs(flow.pot_pence))} /></Pair>}
            {flow.set_aside_pence !== 0 && <Pair op={flow.set_aside_pence < 0 ? "−" : "+"}><Term k="Set aside" v={formatGBP(Math.abs(flow.set_aside_pence))} /></Pair>}
            {flow.adjust_pence !== 0 && <Pair op={flow.adjust_pence < 0 ? "−" : "+"}><Term k="Adjusted" v={formatGBP(Math.abs(flow.adjust_pence))} /></Pair>}
          </div>
        ) : (
          <div className="equation"><div className="skeleton" style={{ height: 40, width: "100%" }} aria-busy /></div>
        )}
      </section>

      <div style={{ marginTop: 24 }} className="stack">
        <TripCard />
        <PaceCard today={today} pace={pace} trackingStart={profile?.tracking_started_on} />
        <BillsCard />
        <InsightCard variant="home" />
        <ReminderPrompt />
      </div>

      <div className="section-h"><h2>Recent</h2><Link className="link" href="/activity">See all</Link></div>
      {recentLoading && recent.length === 0 ? (
        <div className="list" aria-busy>{[0, 1, 2].map((i) => <div key={i} className="row"><div className="skeleton" style={{ height: 36, width: "100%" }} /></div>)}</div>
      ) : recent.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 28 }}>
          <div className="headline">Nothing logged yet</div>
          <p className="sub" style={{ marginTop: 6 }}>Tap ＋ to add your first expense. It takes a few seconds.</p>
          <button className="btn" style={{ marginTop: 16, height: 48 }} onClick={() => open()}>Add transaction</button>
        </div>
      ) : (
        <div className="list" role="list">
          {recent.map((r) => <TxnItem key={r.client_id} row={r} subtitle={`${rowSubtitle(r)} · ${recentWhen(r, today)}`} />)}
        </div>
      )}
      <PotsSection />
    </div>
  );
}

/** An operator and its term stay together if the equation has to wrap onto a second line. */
function Pair({ op, children }: { op: string; children: React.ReactNode }) {
  return <span className="eq-pair"><span className="eq-op">{op}</span>{children}</span>;
}

function Term({ k, v, pos }: { k: string; v: string; pos?: boolean }) {
  return <div className="eq-term"><span className="eq-k">{k}</span><span className={`eq-v ${pos ? "pos" : ""}`}>{v}</span></div>;
}

/** CASH-05: month-to-date spend, with a tick where last month was at this point. */
function PaceCard({ today, pace, trackingStart }: { today: string; pace: ReturnType<typeof usePace>["data"]; trackingStart?: string | null }) {
  if (!pace) return <div className="card pace"><div className="skeleton" style={{ height: 108 }} aria-busy /></div>;
  const prevName = formatMonth(addMonths(monthStart(today), -1));
  const diff = pace.prev_spend_pence - pace.spend_pence;
  const scale = Math.max(pace.prev_total_pence, pace.spend_pence, pace.prev_spend_pence, 1);
  // BAL-07: a month that started before tracking only has what was back-filled, so it is not a fair comparison
  const prevPartial = !!trackingStart && addMonths(monthStart(today), -1) <= monthStart(trackingStart);
  const hasPrev = pace.prev_total_pence > 0 && !prevPartial;
  return (
    <div className="card pace" data-testid="pace">
      <div className="row-between"><span className="k">{formatMonth(today)} so far</span><span className="k">Day {pace.day_of_month} of {pace.days_in_month}</span></div>
      <div className="pace-amt num">{formatGBP(pace.spend_pence)} <span>spent</span></div>
      <div className="track" role="img" aria-label={hasPrev ? `Spent ${formatGBP(pace.spend_pence)}; ${prevName} was ${formatGBP(pace.prev_spend_pence)} by day ${pace.prev_label_day}` : `Spent ${formatGBP(pace.spend_pence)}`}>
        <div className="fill" style={{ width: `${(pace.spend_pence / scale) * 100}%` }} />
        {hasPrev && <div className="tick" style={{ left: `${(pace.prev_spend_pence / scale) * 100}%` }} data-label={`${prevName.slice(0, 3)} by day ${pace.prev_label_day}`} />}
      </div>
      {hasPrev ? (
        <div className="pace-note" style={{ marginTop: 22 }}>
          <i className={`dot ${diff >= 0 ? "pos" : "cau"}`} />
          {diff === 0 ? `Level with this point in ${prevName}` : `${formatGBP(Math.abs(diff))} ${diff > 0 ? "less" : "more"} than this point in ${prevName}`}
        </div>
      ) : (
        <div className="pace-note" style={{ marginTop: 22 }}><i className="dot" />{prevPartial ? "Not enough history yet" : `No ${prevName} to compare with yet`}</div>
      )}
    </div>
  );
}
