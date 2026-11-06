// Forecasting engine types (FORECASTING-ENGINE-PRD §6.14). Input keys are snake_case, exactly the shape of forecast/fixtures/*.input.json;
// the output `Forecast` is camelCase (§6.14.15). Money is integer pence; dates are London-local ISO strings.
export type ISO = string;

/** One London day of facts (from `forecast_daily_facts`). */
export interface DayFact {
  d: ISO;
  discretionary: number;                // expenses excl. recurring, trip, one-off; linked refunds subtracted
  by_cat: Record<string, number>;       // L1 category -> discretionary
  /** All counted spend per L1 category, and its recurring and trip parts (used to build `spent` for any scope). */
  by_cat_all?: Record<string, number>; by_cat_rec?: Record<string, number>; by_cat_trip?: Record<string, number>;
  recurring: number; trip: number; oneoff: number;
  has_activity: boolean;                // any transaction (any type) that day, or a confirmed no-spend marker
  confirmed_zero: boolean;              // "Nothing to log"
  trip_day: boolean;                    // inside a trip's dates
  /** "I didn't log, can't remember" (month close): not evidence, exactly like a day inside a logging gap. Absent in older fixtures. */
  not_tracked?: boolean;
}

export type ScheduledKind = "bill" | "bill_estimate" | "future_dated" | "likely_recurring" | "extra";
export interface ScheduledIn { d: ISO; amount: number; label: string; kind: ScheduledKind; category: string | null; varies: boolean }
export interface TripIn { start: ISO; end: ISO; budget: number | null; spent_to_date: number; past_trip_daily_median?: number | null }
export interface PlannedExtraIn { id?: string; label: string; amount: number; d?: ISO | null; category?: string | null }

export interface EngineParams {
  k_base: number; k_min: number; half_life: number; window_days: number; min_history_for_prior: number;
  dow_min_history: number; dow_lambda: number; pos_min_months: number; pos_lambda: number; winsor_min_days: number; winsor_pct: number;
  ratio_min_expected: number; ratio_clamp: [number, number]; gap_run: number; resid_cv_default: number; ratio_sd_default: number; z90: number;
}

export interface ForecastInput {
  description?: string;
  today: ISO;
  /** The month being forecast, as its first day. Default: the month of `today`. A past month returns `actual`, a future one `prior-only`. */
  month?: ISO;
  tracking_started_on: ISO;
  days: DayFact[];
  spent_month_to_date: number;
  spent_by_cat?: Record<string, number>;
  scheduled: ScheduledIn[];
  trips: TripIn[];
  categories?: string[];
  /** The budget's "Covers" setting (EC-F20). The caller filters bills; with trips excluded the engine adds no trip component. */
  scope?: "all" | "exclude_bills" | "exclude_trips" | "exclude_both";
  params?: Partial<EngineParams>;
  planned_extras?: PlannedExtraIn[];
  /** The one-offs this month, by name, for the Why sheet. */
  one_offs?: { id: string; d: ISO; amount: number; label: string; category: string | null }[];
  /** Backtest mean absolute % error for this day-of-month band, when known (§6.14.11). */
  backtest_mape?: number | null;
  /** When the model parameters last changed, for the explanation (EC-F29). */
  params_changed?: { on: ISO; k: number; half_life: number } | null;
  data_version?: number; params_version?: string;
}

export type Regime = "insufficient" | "this-month-only" | "history" | "history+weekday" | "full" | "full+season" | "prior-only" | "actual";
export type Confidence = "High" | "Medium" | "Low";

export interface Forecast {
  regime: Regime;
  point: number | null;
  floor: number;
  low: number | null; high: number | null;
  confidence: Confidence;
  components: { spent: number; scheduled: number; restOfMonth: number; trips: number; extras: number };
  scheduledItems: { date: ISO; label: string; amount: number; kind: ScheduledKind; varies: boolean }[];
  evidence: { completedDays: number; weightThisMonth: number; ratioActual: number | null; ratioUsed: number; loggedToday: number };
  prior: { historyDays: number; historyFrom: ISO | null; historyTo: ISO | null; usualPerDay: number | null; weekdayProfile: boolean;
           monthPositionProfile: boolean; season: number | null; kEff: number | null; halfLife: number };
  daysLeft: number;
  perDay: { date: ISO; expected: number }[];
  categories?: Record<string, { point: number; restOfMonth: number; weightThisMonth: number | null; spent: number; scheduled: number }>;
  everythingElse?: number;
  explanation: string[];
  message?: string;
  paramsVersion: string; dataVersion: number;
  /** Extra detail the Why sheet needs (not in the fixture contract). */
  detail: { weekdayMultipliers: number[] | null; positionMultipliers: number[] | null; nextSwitch: string[]; oneOffs: { id: string; d: ISO; amount: number; label: string }[]; monthStart: ISO; monthEnd: ISO; closed: boolean };
}
