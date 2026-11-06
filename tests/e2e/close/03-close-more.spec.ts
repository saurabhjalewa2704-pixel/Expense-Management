import { expect, test } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sql, sqlOne } from "../db";
import { startClose } from "../helpers";

const LOG = resolve(".stack/push.log");
const pushes = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l) as { endpoint: string; title: string; body: string; url: string }) : []);
const AUTH = { authorization: "Bearer local-cron-secret" };

test.describe("month close: several months, a first partial month and notifications", () => {
  test("EC-MC32 several months open: oldest first, with Close without review for the older one", async ({ page }) => {
    await startClose(page);
    await sql(`update profiles set close_since = '2026-10-01'`);
    await page.reload();
    await expect(page.getByTestId("close-card")).toContainText("2 months to close");
    await expect(page.getByTestId("close-start-card")).toContainText("Close October");
    await page.getByTestId("close-start-card").click();
    await expect(page.getByTestId("close-title")).toHaveText("Let’s close October");
    await expect(page.getByTestId("close-quick")).toBeVisible();                       // October is older and November is also waiting
    await page.getByTestId("close-quick").click();
    await expect(page).toHaveURL(/\/$/);
    const oct = await sqlOne<{ status: string; snapshot: object | null }>(`select status, snapshot from month_closes where month = '2026-10-01'`);
    expect(oct.status).toBe("closed_quick");
    expect(oct.snapshot).not.toBeNull();
    expect((await sql(`select count(*)::int as n from month_close_answers where month = '2026-10-01'`))[0]!.n).toBe(0);
    await expect(page.getByTestId("close-card")).toContainText("November is ready to close");
    await page.goto("/close/2026-11");
    await expect(page.getByTestId("close-quick")).toHaveCount(0);                      // the newest month has no quick close
    await page.goto("/settings/month-close");
    await expect(page.getByTestId("close-history-row").first()).toContainText("Open");
    await expect(page.getByTestId("close-history-row").nth(1)).toContainText("Closed");
  });

  test("EC-MC33 a first, partial month: the card says what it covers, and the review hides the comparison with usual and the forecast table", async ({ page }) => {
    await startClose(page);
    await sql(`update profiles set tracking_started_on = '2026-11-18'`);
    await page.reload();
    await expect(page.getByTestId("close-card-line")).toHaveText("Tracked from 18 Nov, so this one covers 13 days.");
    await page.goto("/close/2026-11/review");
    await expect(page.getByTestId("close-review")).toBeVisible();
    await expect(page.getByTestId("tile-everyday")).not.toContainText("vs usual");
    await expect(page.getByTestId("review-forecast")).toHaveCount(0);
    await page.goto("/close/2026-11/missing-days");
    await expect(page.getByTestId("missing-day")).toHaveCount(0);                              // EC-MC7 the 5th and the 14th are before tracking began: never listed
    await expect(page.getByTestId("close-title")).toHaveText("Every day has something logged");
  });

  test("EC-MC3 a month with nothing logged: one run covering the month, the banner, and a £0 review", async ({ page }) => {
    await startClose(page);
    await sql(`delete from no_spend_days`);
    await sql(`update profiles set close_since = '2026-09-01', tracking_started_on = '2026-09-01'`);
    await sql(`update accounts set opening_date = '2026-09-01'`);
    await page.goto("/close/2026-09/missing-days");
    await expect(page.getByTestId("not-logging-banner")).toBeVisible();
    await expect(page.getByTestId("missing-run")).toHaveCount(1);
    await expect(page.getByTestId("missing-run")).toContainText("30 days");
    await page.getByTestId("mark-all-not-tracked").click();
    await expect(page.getByText("Marked as not tracked").first()).toBeVisible();
    await expect.poll(async () => (await sql(`select count(*)::int as n from no_spend_days where kind = 'not_tracked'`))[0]!.n).toBe(30);
    await page.goto("/close/2026-09/review");
    await expect(page.getByTestId("review-spent-amount")).toHaveText("£0.00");
  });

  test("MC-80 the notifications: the first on the 1st at 09:00, the reminder on the 4th at 19:00, never more than two, none once closed", async ({ page, request }) => {
    await startClose(page);
    const owner = await sqlOne<{ id: string }>(`select id from auth.users order by created_at limit 1`);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/owner', 'p', 'a')`, [owner.id]);
    const before = pushes().length;
    const call = async (now: string) => (await (await request.get(`/api/cron/nudge?now=${now}`, { headers: AUTH })).json()) as { close: { result: string; kind?: string }[] };
    expect((await call("2026-12-01T08:30:00Z")).close[0]!.result).toBe("not-due");                    // before 09:00
    const first = await call("2026-12-01T09:05:00Z");
    expect(first.close[0]).toMatchObject({ result: "sent", kind: "ready" });
    const sent = pushes().slice(before);
    expect(sent.at(-1)).toMatchObject({ title: "November is ready to close", body: "Six quick checks, about 2 minutes.", url: "/close/2026-11" });
    expect((await call("2026-12-01T09:10:00Z")).close[0]!.result).toBe("not-due");                     // not twice
    expect((await call("2026-12-02T09:05:00Z")).close).toHaveLength(0);                                // no notification on other days
    const reminder = await call("2026-12-04T19:05:00Z");
    expect(reminder.close[0]).toMatchObject({ result: "sent", kind: "reminder" });
    expect(pushes().slice(before).at(-1)).toMatchObject({ title: "November is still open", body: "Two minutes now keeps December's numbers right." });
    expect((await call("2026-12-04T19:10:00Z")).close[0]!.result).toBe("not-due");                     // at most two a month
    expect((await sqlOne<{ n: number }>(`select count(*)::int as n from month_closes where notified_ready_at is not null and notified_reminder_at is not null`)).n).toBe(1);
  });

  test("MC-80 once the month is closed there is nothing to notify, and a started close reads 'Finish closing'", async ({ page, request }) => {
    await startClose(page);
    const owner = await sqlOne<{ id: string }>(`select id from auth.users order by created_at limit 1`);
    await sql(`insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/owner', 'p', 'a')`, [owner.id]);
    await page.goto("/close/2026-11/missing-days");
    await page.getByTestId("missing-day").first().getByTestId("day-no-spend").click();            // started
    const before = pushes().length;
    await request.get(`/api/cron/nudge?now=2026-12-04T19:05:00Z`, { headers: AUTH });
    expect(pushes().slice(before).at(-1)).toMatchObject({ title: "Finish closing November", url: "/close/2026-11?resume=1" });
    await page.goto("/close/2026-11/next-month");
    await page.getByTestId("close-month").click();
    await expect(page.getByTestId("done-title")).toBeVisible();
    await sql(`update month_closes set notified_reminder_at = null`);
    const after = pushes().length;
    const r = await (await request.get(`/api/cron/nudge?now=2026-12-04T19:06:00Z`, { headers: AUTH })).json() as { close: { result: string }[] };
    expect(r.close[0]!.result).toBe("nothing-to-close");
    expect(pushes().length).toBe(after);
  });
});
