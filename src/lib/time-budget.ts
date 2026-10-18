/**
 * Time budget for long generation requests.
 *
 * On Vercel (VERCEL is set) the function is killed at maxDuration, so
 * generation must finish — and stream its final event — before then. Locally
 * there is no limit unless GENERATION_TIME_BUDGET_SECONDS is set.
 */
export const DEADLINE_MARGIN_MS = 20_000;

export function generationDeadline(startedAt: number, maxDurationS: number, env: Record<string, string | undefined> = process.env): number | undefined {
  const override = Number(env.GENERATION_TIME_BUDGET_SECONDS);
  if (Number.isFinite(override) && override > 0) return startedAt + override * 1000;
  if (!env.VERCEL) return undefined;
  return startedAt + maxDurationS * 1000 - DEADLINE_MARGIN_MS;
}
