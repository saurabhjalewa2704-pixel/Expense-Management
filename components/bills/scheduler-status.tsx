"use client";
import { useQuery } from "@tanstack/react-query";
import { schedulerStatus } from "@/app/actions/recurring";
import { formatShort, londonTime, londonDateOf } from "@/lib/dates";

/** Tells the owner whether the scheduled job that logs bills (and sends notifications) has run, and what to fix if it has not. */
export function SchedulerStatus() {
  const { data } = useQuery({ queryKey: ["bills-scheduler"], queryFn: async () => { const r = await schedulerStatus(); return r.ok ? r.data : null; }, staleTime: 5 * 60_000 });
  if (!data) return null;
  const when = (iso: string) => `${formatShort(londonDateOf(iso))}, ${londonTime(iso)}`;
  if (data.cronAlive) return <p className="bill-note" data-testid="scheduler-ok">Logged automatically each morning · last run {when(data.cronAt!)}.</p>;
  const missing = [!data.cronSecret && "CRON_SECRET", !data.serviceKey && "SUPABASE_SERVICE_ROLE_KEY"].filter(Boolean) as string[];
  return (
    <section className="card" style={{ marginTop: 16 }} data-testid="scheduler-warning">
      <div className="headline">The morning job hasn’t run</div>
      <p className="sub" style={{ marginTop: 6, lineHeight: 1.45 }}>
        {data.cronAt ? `It last ran on ${when(data.cronAt)}. ` : "It has never run. "}
        Bills still log whenever you open the app{data.checkedAt ? ` (last checked ${when(data.checkedAt)})` : ""}, but they won’t log on their own, and you won’t get notifications, until the job is set up.
      </p>
      {missing.length > 0 && <p className="sub" style={{ marginTop: 8, lineHeight: 1.45 }}>Missing on the server: <b style={{ color: "var(--ink)" }}>{missing.join(" and ")}</b>. Add {missing.length > 1 ? "them" : "it"} in Vercel → Settings → Environment Variables, then redeploy.</p>}
    </section>
  );
}
