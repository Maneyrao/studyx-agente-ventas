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

export type PaymentProviderConfig =
  | { provider: 'fake' }
  | {
      provider: 'stripe_test';
      secretKey: string;
      webhookSecret: string;
      successUrl: string;
      cancelUrl: string;
    };

/**
 * Payment provider selection. Fail closed on anything suspicious:
 *   - stripe_test refuses a live secret key outright;
 *   - stripe_live is DISABLED in this phase — selecting it always throws, so
 *     no configuration mistake can reach real money. (When it is eventually
 *     enabled, the provider still runs assertRealSideEffectAllowed per
 *     contact before any live call.)
 */
export function loadPaymentProviderConfig(
  environment: NodeJS.ProcessEnv = process.env,
): PaymentProviderConfig {
  const raw = (environment.PAYMENT_PROVIDER ?? 'fake').trim();
  if (raw === 'fake') return { provider: 'fake' };
  if (raw === 'stripe_live') throw new Error('STRIPE_LIVE_DISABLED');
  if (raw !== 'stripe_test') throw new Error('INVALID_PAYMENT_CONFIG:PAYMENT_PROVIDER');

  const secretKey = environment.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = environment.STRIPE_WEBHOOK_SECRET?.trim();
  const successUrl = environment.STRIPE_SUCCESS_URL?.trim();
  const cancelUrl = environment.STRIPE_CANCEL_URL?.trim();
  for (const [name, value] of [
    ['STRIPE_SECRET_KEY', secretKey],
    ['STRIPE_WEBHOOK_SECRET', webhookSecret],
    ['STRIPE_SUCCESS_URL', successUrl],
    ['STRIPE_CANCEL_URL', cancelUrl],
  ] as const) {
    if (!value) throw new Error(`MISSING_PAYMENT_CONFIG:${name}`);
  }
  if (secretKey!.startsWith('sk_live') || secretKey!.startsWith('rk_live')) {
    throw new Error('STRIPE_TEST_REJECTS_LIVE_KEY');
  }
  return {
    provider: 'stripe_test',
    secretKey: secretKey!,
    webhookSecret: webhookSecret!,
    successUrl: successUrl!,
    cancelUrl: cancelUrl!,
  };
}

/**
 * The three owner-approved Stripe payment link env vars (spec §3, §9).
 * `config-payment-link.resolver.ts` remains the sole authority that reads
 * them and fails closed per-plan; this list only documents the names once so
 * a caller (or a test building a synthetic env) has one place to look them
 * up instead of re-discovering them in the resolver's private map.
 */
export const PAYMENT_LINK_ENV_VARS = ['PAYMENT_LINK_12M', 'PAYMENT_LINK_6M', 'PAYMENT_LINK_CONTADO'] as const;

export interface SheetsProjectionConfig {
  readonly spreadsheetId: string;
  readonly tabName: string;
}

/**
 * Where the Sheets outbox writes (spec §5, §9). Fails closed to `null`
 * rather than throwing: a deployment without Sheets configured must still
 * commit decisions and deliver messages normally — enqueueing the
 * `payment_link_sent` projection is what gets skipped, never the canonical
 * write it follows.
 */
export function loadSheetsProjectionConfig(
  environment: NodeJS.ProcessEnv = process.env,
): SheetsProjectionConfig | null {
  const spreadsheetId = environment.GOOGLE_SHEETS_SPREADSHEET_ID?.trim();
  const tabName = environment.GOOGLE_SHEETS_TAB_NAME?.trim();
  if (!spreadsheetId || !tabName) return null;
  return { spreadsheetId, tabName };
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

export type MessagingChannelName = 'telegram' | 'whatsapp';

export type TelegramChannelConfig = {
  botToken: string;
  /** Identifies the integration instance inside the delivery ledger. */
  integrationId: string;
  requestTimeoutMs: number;
};

export type WhatsAppChannelConfig = {
  accessToken: string;
  phoneNumberId: string;
  /**
   * Graph API version, pinned on purpose. Meta ships breaking changes between
   * versions, so the bump is a reviewed decision and never an implicit default.
   */
  graphApiVersion: string;
  integrationId: string;
  requestTimeoutMs: number;
};

export type MessagingChannelsConfig = {
  telegram: TelegramChannelConfig | null;
  whatsapp: WhatsAppChannelConfig | null;
  /** Deterministic fallback order used when the caller states no preference. */
  channelPreference: MessagingChannelName[];
};

const GRAPH_API_VERSION_PATTERN = /^v[0-9]+\.[0-9]+$/;

function parseChannelPreference(raw: string | undefined): MessagingChannelName[] {
  const fallback: MessagingChannelName[] = ['whatsapp', 'telegram'];
  if (!raw?.trim()) return fallback;
  const parsed = raw.split(',').map((part) => part.trim()).filter(Boolean);
  for (const name of parsed) {
    if (name !== 'telegram' && name !== 'whatsapp') {
      throw new Error(`INVALID_MESSAGING_CONFIG:MESSAGING_CHANNEL_PREFERENCE:${name}`);
    }
  }
  const deduped = [...new Set(parsed)] as MessagingChannelName[];
  return deduped.length > 0 ? deduped : fallback;
}

/**
 * Outbound messaging channels the orchestrator delivers through itself.
 *
 * A channel is configured or absent, never half-configured: partial credentials
 * would fail at send time, in the middle of a live call, instead of at boot.
 */
export function loadMessagingChannelsConfig(
  environment: NodeJS.ProcessEnv = process.env,
): MessagingChannelsConfig {
  const telegramToken = environment.TELEGRAM_AGENT_B_BOT_TOKEN?.trim();
  const telegram: TelegramChannelConfig | null = telegramToken
    ? {
      botToken: telegramToken,
      integrationId: environment.MESSAGING_TELEGRAM_INTEGRATION_ID?.trim() || 'telegram-bot',
      requestTimeoutMs: parsePositiveInt(environment.MESSAGING_REQUEST_TIMEOUT_MS, 5_000),
    }
    : null;

  const whatsappToken = environment.WHATSAPP_CLOUD_ACCESS_TOKEN?.trim();
  let whatsapp: WhatsAppChannelConfig | null = null;
  if (whatsappToken) {
    for (const key of ['WHATSAPP_CLOUD_PHONE_NUMBER_ID', 'WHATSAPP_CLOUD_GRAPH_API_VERSION'] as const) {
      if (!environment[key]?.trim()) throw new Error(`MISSING_MESSAGING_CONFIG:${key}`);
    }
    const graphApiVersion = environment.WHATSAPP_CLOUD_GRAPH_API_VERSION!.trim();
    if (!GRAPH_API_VERSION_PATTERN.test(graphApiVersion)) {
      throw new Error('INVALID_MESSAGING_CONFIG:WHATSAPP_CLOUD_GRAPH_API_VERSION');
    }
    whatsapp = {
      accessToken: whatsappToken,
      phoneNumberId: environment.WHATSAPP_CLOUD_PHONE_NUMBER_ID!.trim(),
      graphApiVersion,
      integrationId: environment.MESSAGING_WHATSAPP_INTEGRATION_ID?.trim() || 'whatsapp-cloud',
      requestTimeoutMs: parsePositiveInt(environment.MESSAGING_REQUEST_TIMEOUT_MS, 5_000),
    };
  }

  return {
    telegram,
    whatsapp,
    channelPreference: parseChannelPreference(environment.MESSAGING_CHANNEL_PREFERENCE),
  };
}
