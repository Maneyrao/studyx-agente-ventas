export function buildSmokeRequest({ model, tools }) {
  return {
    model,
    instructions: 'Sos un asesor de StudyX. Usá las herramientas disponibles antes de responder.',
    input: 'Quiero saber qué cursos de marketing tienen y cuánto salen.',
    tools,
    reasoning: { effort: 'none' },
    temperature: 0.2,
    stream: false,
    max_output_tokens: 1600,
  };
}

export function classifySmokeOutcome(payload) {
  if (payload?.status === 'incomplete') {
    return { kind: 'incomplete', call_ids: [], reason: payload.incomplete_details?.reason ?? null };
  }
  const calls = (payload?.output ?? []).filter((item) => item?.type === 'function_call');
  if (calls.length > 0) {
    return { kind: 'function_call', call_ids: calls.map((call) => call.call_id), reason: null };
  }
  return { kind: 'message', call_ids: [], reason: null };
}

// Forma plana (Responses API), no la forma anidada `function: {...}` de Chat
// Completions. DeepSeek respondió 400 "missing field `name`" contra la forma
// anidada: /responses exige name/description/parameters al nivel superior.
const TOOLS = [{
  type: 'function',
  name: 'search_catalog',
  description: 'Busca cursos en el catálogo canónico de StudyX.',
  parameters: {
    type: 'object',
    properties: { area: { type: 'string', description: 'Área temática' } },
    required: ['area'],
  },
}];

async function main() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY_MISSING');
  if (!process.env.STUDYX_AGENT_A_BUDGET_FILE) throw new Error('AGENT_A_BUDGET_FILE_REQUIRED');
  const model = process.env.STUDYX_SMOKE_MODEL ?? 'deepseek-v4-flash';

  const started = Date.now();
  const response = await fetch('https://api.deepseek.com/responses', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify(buildSmokeRequest({ model, tools: TOOLS })),
  });
  const payload = await response.json();
  const round1 = classifySmokeOutcome(payload);
  // Evidencia SIN credenciales y SIN contenido de cliente: sólo forma y tiempos.
  console.log(JSON.stringify({
    event: 'smoke.round_1', http_status: response.status, model,
    kind: round1.kind, call_count: round1.call_ids.length,
    incomplete_reason: round1.reason, latency_ms: Date.now() - started,
  }));
  if (round1.kind !== 'function_call') throw new Error(`SMOKE_NO_TOOL_CALL:${round1.kind}`);
}

if (process.argv[1]?.endsWith('smoke-deepseek-tools.mjs')) {
  main().catch((error) => { console.error(String(error.message)); process.exit(1); });
}
