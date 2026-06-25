function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export const config = {
  summaryThreshold: parsePositiveInt(process.env.SUMMARY_THRESHOLD, 10),
  summaryModel: process.env.SUMMARY_MODEL ?? 'gpt-4o-mini',
  recentTurnsLimit: parsePositiveInt(process.env.RECENT_TURNS_LIMIT, 10),
  ltmResultsLimit: parsePositiveInt(process.env.LTM_RESULTS_LIMIT, 5),
};
