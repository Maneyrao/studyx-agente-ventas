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
  summaryModel: process.env.SUMMARY_MODEL ?? 'gemini-2.5-flash',
  recentTurnsLimit: parsePositiveInt(process.env.RECENT_TURNS_LIMIT, 10),
  ltmResultsLimit: parsePositiveInt(process.env.LTM_RESULTS_LIMIT, 5),
  kbResultsLimit: parsePositiveInt(process.env.KB_RESULTS_LIMIT, 5),
  kbMinSimilarity: parseFloat01(process.env.KB_MIN_SIMILARITY, 0.75),
};

export type BusinessWorkspaceConfig = {
  /** Slug of the tenant whose data this deployment serves. Backend-derived:
   * model output never selects the workspace. */
  workspaceSlug: string;
};

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

export function loadBusinessWorkspaceConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BusinessWorkspaceConfig {
  const raw = environment.BUSINESS_WORKSPACE_SLUG?.trim();
  if (!raw) throw new Error('MISSING_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG');
  if (!WORKSPACE_SLUG_PATTERN.test(raw)) {
    throw new Error('INVALID_BUSINESS_CONFIG:BUSINESS_WORKSPACE_SLUG');
  }
  return { workspaceSlug: raw };
}

export type TelegramAgentBConfig = {
  botToken: string;
  webhookSecret: string;
  smokeChatId: string;
  smokeUserId: string;
  requestTimeoutMs: number;
  voiceProvider: 'telegram_sandbox' | 'retell';
};

export function loadTelegramAgentBConfig(
  environment: NodeJS.ProcessEnv = process.env,
): TelegramAgentBConfig {
  const required = [
    'TELEGRAM_AGENT_B_BOT_TOKEN',
    'TELEGRAM_AGENT_B_WEBHOOK_SECRET',
    'TELEGRAM_AGENT_B_SMOKE_CHAT_ID',
    'TELEGRAM_AGENT_B_SMOKE_USER_ID',
  ] as const;
  for (const key of required) {
    if (!environment[key]?.trim()) throw new Error(`MISSING_AGENT_B_CONFIG:${key}`);
  }
  const voiceProvider = environment.VOICE_PROVIDER ?? 'telegram_sandbox';
  if (voiceProvider !== 'telegram_sandbox' && voiceProvider !== 'retell') {
    throw new Error('INVALID_AGENT_B_CONFIG:VOICE_PROVIDER');
  }
  return {
    botToken: environment.TELEGRAM_AGENT_B_BOT_TOKEN!,
    webhookSecret: environment.TELEGRAM_AGENT_B_WEBHOOK_SECRET!,
    smokeChatId: environment.TELEGRAM_AGENT_B_SMOKE_CHAT_ID!,
    smokeUserId: environment.TELEGRAM_AGENT_B_SMOKE_USER_ID!,
    requestTimeoutMs: parsePositiveInt(environment.TELEGRAM_AGENT_B_REQUEST_TIMEOUT_MS, 5_000),
    voiceProvider,
  };
}
