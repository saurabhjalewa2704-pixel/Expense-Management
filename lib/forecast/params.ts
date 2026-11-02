import type { EngineParams } from "./types";

/** Defaults (§6.14.13 tunes `k_base` and `half_life` within safe bounds). */
export const DEFAULT_PARAMS: EngineParams = {
  k_base: 7, k_min: 3, half_life: 60, window_days: 365, min_history_for_prior: 3,
  dow_min_history: 21, dow_lambda: 4, pos_min_months: 2, pos_lambda: 10, winsor_min_days: 30, winsor_pct: 0.97,
  ratio_min_expected: 3000, ratio_clamp: [0.4, 2.5], gap_run: 3, resid_cv_default: 0.9, ratio_sd_default: 0.2, z90: 1.2816,
};
export const K_GRID = [3, 5, 7, 10, 14] as const;
export const HALF_LIFE_GRID = [30, 60, 120] as const;
