import { z } from "zod";

export const AccountInput = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, "Give the account a name.").max(40, "Keep the name under 40 characters."),
  institution: z.string().trim().max(60).nullish(),
  type: z.enum(["current", "savings", "credit_card", "cash", "other"]),
  /** Signed pence: money owed on a card is negative. Only used when creating. */
  opening_balance_pence: z.number().int().min(-99_999_999_99).max(99_999_999_99).default(0),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  counts_as_cash: z.boolean(),
});
export type AccountInput = z.input<typeof AccountInput>;

/** ACC-01: savings stay out of available cash by default; everything else is in. */
export const defaultCountsAsCash = (type: AccountInput["type"]) => type !== "savings";
