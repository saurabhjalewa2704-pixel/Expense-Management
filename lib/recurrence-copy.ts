// REC-03's plain-English line under the form ("Sterling will log £12.99 to Netflix at 6am on the 27th of every month…").
import { formatDayMonth, formatShort, type ISODate } from "@/lib/dates";
import { formatGBP } from "@/lib/money";
import { movesInShortMonths, ordinal, type RecurrenceRule } from "@/lib/recurrence";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export interface SentenceInput {
  type: "expense" | "income" | "transfer";
  amount_pence: number; amount_varies: boolean; auto_log: boolean;
  /** Payee for an expense or income, the receiving account for a transfer. */
  to: string; from?: string;
  rule: RecurrenceRule;
  first: ISODate | null;
}

function whenWords(r: RecurrenceRule): string {
  const day = r.last_day ? "the last day" : `the ${ordinal(r.day_of_month ?? 1)}`;
  switch (r.frequency) {
    case "weekly": return `every ${WEEKDAYS[(r.weekday ?? 1) - 1]}`;
    case "monthly": return `on ${day} of every month`;
    case "quarterly": return `on ${day} every 3 months`;
    default: return `on ${r.last_day ? "the last day of" : r.day_of_month} ${MONTHS[(r.month_of_year ?? 1) - 1]} every year`;
  }
}

export function ruleSentence(i: SentenceInput): string {
  const amt = i.amount_pence > 0 ? formatGBP(i.amount_pence) : "the amount";
  const what = i.type === "transfer" ? `move ${amt} from ${i.from ?? "your account"} to ${i.to || "savings"}`
    : i.type === "income" ? `log ${amt} from ${i.to || "your payer"}` : `log ${amt} to ${i.to || "the payee"}`;
  const lead = i.auto_log ? `Sterling will ${what} at 6am ${whenWords(i.rule)}` : `Sterling will remind you at 6am ${whenWords(i.rule)} to ${what}, and you confirm it`;
  const parts = [`${lead}${i.first ? `, starting ${formatShort(i.first)}` : ""}.`];
  if (movesInShortMonths(i.rule)) parts.push("In shorter months, days 29–31 move to the last day.");
  if (i.rule.working_day_rule === "next_working_day") parts.push("If that is a weekend or bank holiday, it moves to the next working day.");
  if (i.amount_varies) parts.push("The amount varies, so Sterling logs your last amount as an estimate and asks you to confirm it.");
  if (i.rule.ends_on) parts.push(`It ends on ${formatDayMonth(i.rule.ends_on)} ${i.rule.ends_on.slice(0, 4)}.`);
  else if (i.rule.max_occurrences) parts.push(`It ends after ${i.rule.max_occurrences} payment${i.rule.max_occurrences === 1 ? "" : "s"}.`);
  return parts.join(" ");
}
