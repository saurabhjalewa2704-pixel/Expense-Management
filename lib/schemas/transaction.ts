import { z } from "zod";
import { MAX_PENCE } from "@/lib/money";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date.");

/** The shape shared by Quick Add (client) and the Server Actions (server). */
const base = z.object({
  type: z.enum(["expense", "income", "transfer"]),
  amount_pence: z.number().int("Amount must be in whole pence.").positive("Enter an amount.").max(MAX_PENCE, "That's more than £999,999.99."),
  account_id: z.uuid("Choose an account."),
  counter_account_id: z.uuid().nullish(),
  category_id: z.uuid().nullish(),
  payee: z.string().trim().max(80, "Keep the payee under 80 characters.").nullish(),
  note: z.string().trim().max(280, "Keep the note under 280 characters.").nullish(),
  tags: z.array(z.string().trim().min(1).max(30)).max(10).default([]),
  occurred_on: isoDate,
  occurred_at: z.iso.datetime({ offset: true }).nullish(),
});

type Shape = z.infer<typeof base>;
const rules = (v: Shape, ctx: z.RefinementCtx) => {
  if (v.type === "transfer") {
    if (!v.counter_account_id) ctx.addIssue({ code: "custom", path: ["counter_account_id"], message: "Choose the account it goes to." });
    else if (v.counter_account_id === v.account_id) ctx.addIssue({ code: "custom", path: ["counter_account_id"], message: "Choose two different accounts." });
  } else if (!v.category_id) {
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
