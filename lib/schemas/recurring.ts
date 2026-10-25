import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { MAX_PENCE } from "@/lib/money";

const date = z.string().refine(isISODate, "Choose a date.");

/** REC-03 validation. Shared by the form (instant feedback) and the Server Action (the real check). */
export const RecurringInput = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount_pence: z.number().int().positive("Enter an amount more than £0.").max(MAX_PENCE, "That amount is too large."),
  amount_varies: z.boolean().default(false),
  account_id: z.string().uuid("Choose an account."),
  counter_account_id: z.string().uuid().nullish(),
  category_id: z.string().uuid().nullish(),
  payee: z.string().trim().max(80).nullish(),
  note: z.string().trim().max(280).nullish(),
  frequency: z.enum(["weekly", "monthly", "quarterly", "yearly"]),
  day_of_month: z.number().int().min(1).max(31).nullish(),
  last_day: z.boolean().default(false),
  weekday: z.number().int().min(1).max(7).nullish(),
  month_of_year: z.number().int().min(1).max(12).nullish(),
  working_day_rule: z.enum(["on_day", "next_working_day"]).default("on_day"),
  starts_on: date,
  ends_on: date.nullish(),
  max_occurrences: z.number().int().min(1).max(1200).nullish(),
  auto_log: z.boolean().default(true),
  /** Create only: the chosen day has passed this month, so log this month's payment now or start next month. */
  catch_up: z.enum(["log", "next"]).default("next"),
}).superRefine((v, ctx) => {
  const bad = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
  if (v.type === "transfer") {
    if (!v.counter_account_id) bad("counter_account_id", "Choose the account it goes to.");
    else if (v.counter_account_id === v.account_id) bad("counter_account_id", "Choose two different accounts.");
  } else {
    if (!v.category_id) bad("category_id", "Choose a category.");
    if (v.type === "expense" && !v.payee?.trim()) bad("payee", "Who is it paid to?");
  }
  if (v.frequency === "weekly" && !v.weekday) bad("weekday", "Choose a weekday.");
  if (v.frequency === "yearly" && !v.month_of_year) bad("month_of_year", "Choose a month.");
  if (v.frequency !== "weekly" && !v.last_day && !v.day_of_month) bad("day_of_month", "Choose a day of the month.");
  if (v.ends_on && v.ends_on < v.starts_on) bad("ends_on", "It cannot end before it starts.");
});
export type RecurringInputT = z.input<typeof RecurringInput>;
