/**
 * Time budget for long generation requests.
 *
 * On Vercel (VERCEL is set) the function is killed at maxDuration, so
 * generation must finish — and stream its final event — before then. Locally
 * there is no limit unless GENERATION_TIME_BUDGET_SECONDS is set.
 */
export const DEADLINE_MARGIN_MS = 20_000;
/** Don't start a new part with less than this left (a 10-page PDF part can take ~1–2 min). */
export const MAX_RESERVE_MS = 100_000;

export interface TimeBudget {
  /** Hard deadline: parts still running are aborted. */
  deadline: number;
  /** No new part starts within this much of the deadline. */
  reserveMs: number;
}

export function generationBudget(startedAt: number, maxDurationS: number, env: Record<string, string | undefined> = process.env): TimeBudget | undefined {
  const override = Number(env.GENERATION_TIME_BUDGET_SECONDS);
  let budgetMs: number;
  if (Number.isFinite(override) && override > 0) budgetMs = override * 1000;
  else if (env.VERCEL) budgetMs = maxDurationS * 1000 - DEADLINE_MARGIN_MS;
  else return undefined;
  return { deadline: startedAt + budgetMs, reserveMs: Math.min(MAX_RESERVE_MS, Math.round(budgetMs * 0.35)) };
}
