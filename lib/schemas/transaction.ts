import { z } from "zod";
import { addDays, todayLondon } from "@/lib/dates";
import { MAX_PENCE } from "@/lib/money";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

/** The shape shared by Quick Add (client) and the Server Actions (server). */
const base = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount_pence: z.number().int("Amount must be in whole pence.").positive("Enter an amount.").max(MAX_PENCE, "That's more than £999,999.99."),
  account_id: z.uuid("Choose an account."),
  counter_account_id: z.uuid().nullish(),
  category_id: z.uuid().nullish(),
  /** A one-off pot (expenses and income only): kept out of usual spending, analytics and insights. */
  pot_id: z.uuid().nullish(),
  payee: z.string().trim().max(80, "Keep the payee under 80 characters.").nullish(),
  note: z.string().trim().max(280, "Keep the note under 280 characters.").nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  occurred_on: isoDate,
  occurred_at: z.iso.datetime({ offset: true }).nullish(),
  /** The owner's answer when an entry is dated before the account's anchor (BAL-03). Null/absent: the database decides. */
  counts_in_balance: z.boolean().nullish(),
  counter_counts_in_balance: z.boolean().nullish(),
  /** IANA zone where it happened (EC-D1). */
  occurred_tz: z.string().max(64).nullish(),
  /** TRIP-04: the trip this belongs to (null/absent: on create the database auto-tags by date; on edit, `trip_set` says whether to change it). */
  trip_id: z.uuid().nullish(),
  trip_origin: z.enum(["auto", "manual", "booking"]).nullish(),
  /** Create only: the owner removed the chip, so do not auto-tag. */
  trip_untag: z.boolean().nullish(),
  /** Edit only: apply `trip_id` (including null = remove from the trip). */
  trip_set: z.boolean().nullish(),
  /** TRIP-06: the amount as paid, in its own currency's minor units, with the rate (GBP per 1 unit, a decimal string: never a float). */
  original_amount_minor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(),
  original_currency: z.string().regex(/^[A-Za-z]{3}$/, "Choose a currency.").nullish(),
  fx_rate: z.string().regex(/^\d+(\.\d{1,8})?$/, "Enter a rate like 0.79.").nullish(),
  fx_rate_on: isoDate.nullish(),
  fx_source: z.enum(["auto", "manual"]).nullish(),
  /** Edit only: apply the FX fields (including clearing them). */
  fx_set: z.boolean().nullish(),
  /** Edit only: the row's updated_at when the editor opened. If another device changed it since, the edit is not applied (EC-C3). */
  expected_updated_at: z.string().nullish(),
});

type Shape = z.infer<typeof base>;
const rules = (v: Shape, ctx: z.RefinementCtx) => {
  if (isoDate.safeParse(v.occurred_on).success && v.occurred_on > addDays(todayLondon(), 366)) ctx.addIssue({ code: "custom", path: ["occurred_on"], message: "Choose a date within the next 12 months." });
  const fx = [v.original_amount_minor, v.original_currency, v.fx_rate, v.fx_rate_on].filter((x) => x != null).length;
  if (fx !== 0 && fx !== 4) ctx.addIssue({ code: "custom", path: ["fx_rate"], message: "The original amount needs a currency and a rate." });
  if (fx === 4 && v.type !== "expense" && v.type !== "income") ctx.addIssue({ code: "custom", path: ["original_currency"], message: "Only expenses and income can be in another currency." });
  if (v.type === "transfer") {
    if (!v.counter_account_id) ctx.addIssue({ code: "custom", path: ["counter_account_id"], message: "Choose the account it goes to." });
    else if (v.counter_account_id === v.account_id) ctx.addIssue({ code: "custom", path: ["counter_account_id"], message: "Choose two different accounts." });
    if (v.pot_id) ctx.addIssue({ code: "custom", path: ["pot_id"], message: "A transfer can't go in a pot." });
  } else if (!v.category_id && !v.pot_id) {
    // a one-off pot classifies the transaction on its own, so it needs no category
    ctx.addIssue({ code: "custom", path: ["category_id"], message: "Choose a category." });
  }
};

export const TxnInput = base
  .extend({
    client_id: z.uuid(),
    source: z.enum(["app", "nl", "shortcut", "recurring", "favourite", "receipt"]).default("app"),
    /** True when the user picked the account by hand (drives ACC-02 default switching). */
    account_manual: z.boolean().default(false),
  })
  .superRefine(rules);

export const TxnEdit = base.superRefine(rules);

export type TxnInput = z.input<typeof TxnInput>;
export type TxnInputParsed = z.output<typeof TxnInput>;
export type TxnEditInput = z.input<typeof TxnEdit>;
