function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const n = parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseFloat01(raw: string | undefined, fallback: number): number {
  const n = parseFloat(raw ?? '');
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

export const config = {
  summaryThreshold: parsePositiveInt(process.env.SUMMARY_THRESHOLD, 10),
  summaryModel: process.env.SUMMARY_MODEL ?? 'gpt-4o-mini',
  recentTurnsLimit: parsePositiveInt(process.env.RECENT_TURNS_LIMIT, 10),
  ltmResultsLimit: parsePositiveInt(process.env.LTM_RESULTS_LIMIT, 5),
  kbResultsLimit: parsePositiveInt(process.env.KB_RESULTS_LIMIT, 5),
  kbMinSimilarity: parseFloat01(process.env.KB_MIN_SIMILARITY, 0.75),
};
