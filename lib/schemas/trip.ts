import { z } from "zod";
import { isISODate } from "@/lib/dates";
import { MAX_PENCE } from "@/lib/money";

const date = z.string().refine(isISODate, "Choose a date.");
const currency = z.string().regex(/^[A-Za-z]{3}$/, "Choose a currency.").transform((s) => s.toUpperCase());

export const StopInput = z.object({ name: z.string().trim().min(1, "Name the stop.").max(40), start_on: date, end_on: date, currency: currency.nullish() });

/** TRIP-03 validation, shared by the form and the Server Action. */
export const TripInput = z.object({
  name: z.string().trim().min(1, "Give the trip a name.").max(30, "Keep the name to 30 characters."),
  country_code: z.string().regex(/^[A-Za-z]{2}$/).transform((s) => s.toUpperCase()).nullish(),
  currency,
  start_on: date,
  end_on: date,
  budget_pence: z.number().int().positive("A budget must be more than £0.").max(MAX_PENCE).nullish(),
  auto_tag: z.boolean().default(true),
  stops: z.array(StopInput).max(8, "A trip can have up to 8 stops.").default([]),
  category_budgets: z.array(z.object({ category_id: z.uuid(), amount_pence: z.number().int().positive().max(MAX_PENCE) })).default([]),
  /** Edit only: what to do with tagged expenses that now fall outside the dates (bookings are always kept), and whether to take in untagged ones now inside. */
  outside: z.enum(["keep", "remove"]).default("keep"),
  add_in_range: z.boolean().default(false),
}).superRefine((v, ctx) => {
  const bad = (path: (string | number)[], message: string) => ctx.addIssue({ code: "custom", path, message });
  if (v.end_on < v.start_on) bad(["end_on"], "The trip can't end before it starts.");
  const sorted = [...v.stops].map((s, i) => ({ ...s, i })).sort((a, b) => a.start_on.localeCompare(b.start_on));
  sorted.forEach((s, k) => {
    if (s.end_on < s.start_on) bad(["stops", s.i, "end_on"], `${s.name} can't end before it starts.`);
    if (s.start_on < v.start_on || s.end_on > v.end_on) bad(["stops", s.i, "start_on"], `${s.name} has to sit inside the trip dates.`);
    const next = sorted[k + 1];
    if (next && next.start_on <= s.end_on) bad(["stops", next.i, "start_on"], `${next.name} overlaps ${s.name}.`);
  });
  const sum = v.category_budgets.reduce((a, b) => a + b.amount_pence, 0);
  if (v.budget_pence && sum > v.budget_pence) bad(["budget_pence"], "The trip budget has to be at least the category budgets added together.");
});
export type TripInputT = z.input<typeof TripInput>;
