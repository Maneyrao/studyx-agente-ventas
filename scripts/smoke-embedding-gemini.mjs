const MODEL = 'gemini-embedding-2';
const DIMENSIONS = 768;
const startedAt = performance.now();

function report({ dimensions = 0, status }) {
  const durationMs = Math.round(performance.now() - startedAt);
  console.log(`model=${MODEL} dimensions=${dimensions} duration_ms=${durationMs} status=${status}`);
}

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  report({ status: 'missing_api_key' });
  process.exitCode = 1;
} else {
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:embedContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          content: { parts: [{ text: 'task: search result | query: smoke test' }] },
          embedContentConfig: { outputDimensionality: DIMENSIONS },
        }),
      },
    );
    const payload = response.ok ? await response.json() : null;
    const values = payload?.embedding?.values;
    const valid = Array.isArray(values)
      && values.length === DIMENSIONS
      && values.every((value) => typeof value === 'number' && Number.isFinite(value));
    report({ dimensions: Array.isArray(values) ? values.length : 0, status: response.status });
    if (!response.ok || !valid) process.exitCode = 1;
  } catch {
    report({ status: 'network_error' });
    process.exitCode = 1;
  }
}
