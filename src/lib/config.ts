import {
  CONVERSATION_SESSION_IDLE_MS,
  CONVERSATION_STATE_MAX_IDLE_MS,
} from '@/features/conversation/domain/conversation-planner';
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

export function loadConversationPipelineConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { enabled: boolean } {
  return {
    enabled: environment.CONVERSATION_PIPELINE_V1_ENABLED?.trim().toLowerCase() === 'true',
  };
}

/**
 * Ventana de sesión conversacional, en minutos.
 *
 * Gobierna cuándo una pregunta pendiente deja de estar pendiente: pasada la
 * ventana, el próximo mensaje se lee por lo que dice y no como respuesta a algo
 * preguntado horas antes. El default es deliberadamente conservador y NO está
 * calibrado sobre tráfico real; es configurable justamente para poder ajustarlo
 * sin desplegar código una vez que se midan los huecos de producción.
 *
 * Nunca puede superar la expiración total del estado: una pregunta no puede
 * sobrevivir al estado que la contiene.
 */
export function loadConversationSessionConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { sessionIdleMs: number } {
  const minutes = Number.parseInt(
    environment.CONVERSATION_SESSION_IDLE_MINUTES?.trim() ?? '',
    10,
  );
  if (!Number.isFinite(minutes) || minutes <= 0) {
    return { sessionIdleMs: CONVERSATION_SESSION_IDLE_MS };
  }
  return {
    sessionIdleMs: Math.min(minutes * 60 * 1_000, CONVERSATION_STATE_MAX_IDLE_MS),
  };
}

export type AgentABrainRolloutMode = 'legacy' | 'shadow' | 'authoritative' | 'invalid';

export interface AgentABrainConfig {
  readonly enabled: boolean;
  readonly shadow: boolean;
  readonly mode: AgentABrainRolloutMode;
  readonly ready: boolean;
}

export function loadAgentABrainConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentABrainConfig {
  const enabled = environment.AGENT_A_BRAIN_V1_ENABLED?.trim().toLowerCase() === 'true';
  const shadow = environment.AGENT_A_BRAIN_V1_SHADOW?.trim().toLowerCase() === 'true';
  if (enabled && shadow) return { enabled, shadow, mode: 'invalid', ready: false };
  if (enabled) return { enabled, shadow, mode: 'authoritative', ready: true };
  if (shadow) return { enabled, shadow, mode: 'shadow', ready: true };
  return { enabled, shadow, mode: 'legacy', ready: true };
}

/**
 * Recorte de contexto y reparación: conducta nueva, apagada por defecto (R1).
 *
 * Los dos flags gobiernan ÚNICAMENTE lo nuevo. El recorte que ya estaba
 * desplegado —planes de pago y curso seleccionado, condicionados por estado—
 * no tiene flag y no lo va a tener: dárselo significaría escribir un modo sin
 * recorte que hoy no existe, o sea construir a propósito el camino peor para
 * poder volver a él.
 */
export interface AgentARolloutConfig {
  /** Gobierna `capabilities.intake_missing`, nada más. */
  readonly contextScoping: boolean;
  /** Gobierna N2. Apagado, un rechazo no podable cae a N3, nunca a silencio. */
  readonly repairEnabled: boolean;
  /**
   * Desactiva la ruta duplicada: compositor Gemini y `modelUnavailableFallback`.
   *
   * DESACTIVA, no borra. R6: el rollback se conserva hasta que el held-out y
   * el canary estén verdes, y hoy ninguno de los dos pudo ejecutarse. Borrar
   * el código ahora dejaría al sistema sin vuelta atrás antes de tener la
   * evidencia que justificaría no necesitarla.
   */
  readonly singleRoute: boolean;
  /**
   * Gobierna V5 por estado (§ 05b): el egress autoriza una afirmación de
   * estado citando un hecho materializado en vez de por coincidencia léxica.
   *
   * Apagado, el recorte es el de siempre. Encendido, el turno puede afirmar
   * lo que la transición VA a escribir — y eso sólo es cierto si el outbound
   * espera al commit durable (O2/O3). Por eso el flag existe: la capacidad
   * nueva y la garantía de orden se encienden juntas o no se encienden.
   */
  readonly stateAssertions: boolean;
}

export function loadAgentARolloutConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): AgentARolloutConfig {
  return {
    contextScoping: environment.AGENT_A_CONTEXT_SCOPING?.trim().toLowerCase() === 'true',
    repairEnabled: environment.AGENT_A_REPAIR_ENABLED?.trim().toLowerCase() === 'true',
    singleRoute: environment.AGENT_A_SINGLE_ROUTE?.trim().toLowerCase() === 'true',
    stateAssertions: environment.AGENT_A_STATE_ASSERTIONS?.trim().toLowerCase() === 'true',
  };
}

export type BusinessWorkspaceConfig = {
  /** Slug of the tenant whose data this deployment serves. Backend-derived:
   * model output never selects the workspace. */
  workspaceSlug: string;
};

const WORKSPACE_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/;

/**
 * A commercial Agent A turn is only truthful when every named dependency is
 * configured. Values never leave this module; readiness exposes presence only.
 */
export const AGENT_A_REQUIRED_ENVIRONMENT = [
  'DATABASE_URL',
  'BUSINESS_WORKSPACE_SLUG',
  'ORCHESTRATOR_API_KEY',
  'ORCHESTRATOR_KEY_ID',
  'STUDYX_SIGNING_SECRET',
  'CRON_SECRET',
  'PAYMENT_LINK_12M',
  'PAYMENT_LINK_6M',
  'PAYMENT_LINK_CONTADO',
] as const;

/**
 * Providers that enrich or project a committed commercial turn. Their
 * absence must be observable, but cannot make ingest/claim/conversation
 * unavailable: the durable outbox can be reconciled after recovery and the
 * current conversation model does not run in this backend process.
 */
export const AGENT_A_DEGRADABLE_ENVIRONMENT = [
  'GEMINI_API_KEY',
  'GEMINI_MODEL',
  'GOOGLE_SHEETS_CLIENT_EMAIL',
  'GOOGLE_SHEETS_PRIVATE_KEY',
  'GOOGLE_SHEETS_SPREADSHEET_ID',
  'GOOGLE_SHEETS_TAB_NAME',
] as const;

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

/**
 * Gate used before an automated commercial turn. It intentionally returns
 * only the validated workspace identity, not any credential or payment URL.
 */
export function loadAgentACommercialConfig(
  environment: NodeJS.ProcessEnv = process.env,
): BusinessWorkspaceConfig {
  for (const key of AGENT_A_REQUIRED_ENVIRONMENT) {
    if (!environment[key]?.trim()) throw new Error(`MISSING_AGENT_A_CONFIG:${key}`);
  }
  return loadBusinessWorkspaceConfig(environment);
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

export const RETELL_AGENT_ID = 'agent_d2c1a4ac7900ae95a47727156b' as const;
export const RETELL_AGENT_VERSION = 0 as const;
export const RETELL_LLM_ID = 'llm_eea8f670b6569b44689e9394b150' as const;
export const RETELL_LLM_VERSION = 0 as const;

export const RETELL_REQUIRED_ENVIRONMENT = [
  'RETELL_API_KEY',
  'RETELL_FROM_NUMBER',
  'RETELL_API_BASE_URL',
  'RETELL_AGENT_ID',
  'RETELL_AGENT_VERSION',
  'RETELL_LLM_ID',
  'RETELL_LLM_VERSION',
  'RETELL_ADVISOR_NAME',
  'RETELL_TOOLS_SECRET',
] as const;

export type RetellVoiceConfig = {
  voiceProvider: 'retell';
  apiKey: string;
  fromNumber: string;
  apiBaseUrl: string;
  agentId: string;
  agentVersion: number;
  llmId: string;
  llmVersion: number;
  advisorName: string;
  toolsSecret: string;
  requestTimeoutMs: number;
};

export type XendraVoiceConfig = {
  voiceProvider: 'xendra';
  callUrl: string;
  orchestratorSecret: string;
  advisorName: string;
  closerNumber: string;
  telegramCanaryContactId: string | null;
  requestTimeoutMs: number;
};

export type VoiceDispatchConfig =
  | (Omit<TelegramAgentBConfig, 'voiceProvider'> & { voiceProvider: 'telegram_sandbox' })
  | RetellVoiceConfig
  | XendraVoiceConfig;

function retellInteger(
  environment: Readonly<Record<string, string | undefined>>,
  name: 'RETELL_AGENT_VERSION' | 'RETELL_LLM_VERSION',
): number {
  const value = environment[name]!.trim();
  if (!/^\d+$/u.test(value)) throw new Error(`INVALID_RETELL_CONFIG:${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error(`INVALID_RETELL_CONFIG:${name}`);
  return parsed;
}

export function loadRetellVoiceConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): RetellVoiceConfig {
  for (const key of RETELL_REQUIRED_ENVIRONMENT) {
    if (!environment[key]?.trim()) throw new Error(`MISSING_RETELL_CONFIG:${key}`);
  }

  const fromNumber = environment.RETELL_FROM_NUMBER!.trim();
  if (!/^\+[1-9]\d{6,14}$/u.test(fromNumber)) {
    throw new Error('INVALID_RETELL_CONFIG:RETELL_FROM_NUMBER');
  }

  let apiUrl: URL;
  try {
    apiUrl = new URL(environment.RETELL_API_BASE_URL!.trim());
  } catch {
    throw new Error('INVALID_RETELL_CONFIG:RETELL_API_BASE_URL');
  }
  if (
    apiUrl.protocol !== 'https:'
    || apiUrl.username
    || apiUrl.password
    || apiUrl.search
    || apiUrl.hash
    || (apiUrl.pathname !== '/' && apiUrl.pathname !== '')
  ) {
    throw new Error('INVALID_RETELL_CONFIG:RETELL_API_BASE_URL');
  }

  const agentId = environment.RETELL_AGENT_ID!.trim();
  if (!/^agent_[A-Za-z0-9]+$/u.test(agentId)) {
    throw new Error('INVALID_RETELL_CONFIG:RETELL_AGENT_ID');
  }
  const llmId = environment.RETELL_LLM_ID!.trim();
  if (!/^llm_[A-Za-z0-9]+$/u.test(llmId)) {
    throw new Error('INVALID_RETELL_CONFIG:RETELL_LLM_ID');
  }

  return {
    voiceProvider: 'retell',
    apiKey: environment.RETELL_API_KEY!.trim(),
    fromNumber,
    apiBaseUrl: apiUrl.origin,
    agentId,
    agentVersion: retellInteger(environment, 'RETELL_AGENT_VERSION'),
    llmId,
    llmVersion: retellInteger(environment, 'RETELL_LLM_VERSION'),
    advisorName: environment.RETELL_ADVISOR_NAME!.trim(),
    toolsSecret: environment.RETELL_TOOLS_SECRET!.trim(),
    requestTimeoutMs: parsePositiveInt(environment.RETELL_REQUEST_TIMEOUT_MS, 5_000),
  };
}

export function loadXendraVoiceConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): XendraVoiceConfig {
  for (const key of ['XENDRA_CALL_URL', 'XENDRA_ORCHESTRATOR_SECRET'] as const) {
    if (!environment[key]?.trim()) throw new Error(`MISSING_XENDRA_CONFIG:${key}`);
  }

  let callUrl: URL;
  try {
    callUrl = new URL(environment.XENDRA_CALL_URL!.trim());
  } catch {
    throw new Error('INVALID_XENDRA_CONFIG:XENDRA_CALL_URL');
  }
  const loopback = callUrl.hostname === 'localhost'
    || callUrl.hostname === '127.0.0.1'
    || callUrl.hostname === '[::1]';
  if (
    (callUrl.protocol !== 'https:' && !(callUrl.protocol === 'http:' && loopback))
    || callUrl.username
    || callUrl.password
    || callUrl.search
    || callUrl.hash
    || callUrl.pathname === '/'
  ) {
    throw new Error('INVALID_XENDRA_CONFIG:XENDRA_CALL_URL');
  }

  const closerNumber = environment.XENDRA_CLOSER_NUMBER?.trim() ?? '';
  if (closerNumber && !/^\+[1-9]\d{6,14}$/u.test(closerNumber)) {
    throw new Error('INVALID_XENDRA_CONFIG:XENDRA_CLOSER_NUMBER');
  }
  const telegramCanaryContactId = environment.XENDRA_TELEGRAM_CANARY_CONTACT_ID?.trim() || null;
  if (
    telegramCanaryContactId
    && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
      .test(telegramCanaryContactId)
  ) {
    throw new Error('INVALID_XENDRA_CONFIG:XENDRA_TELEGRAM_CANARY_CONTACT_ID');
  }

  return {
    voiceProvider: 'xendra',
    callUrl: callUrl.toString(),
    orchestratorSecret: environment.XENDRA_ORCHESTRATOR_SECRET!.trim(),
    advisorName: environment.XENDRA_ADVISOR_NAME?.trim() ?? '',
    closerNumber,
    telegramCanaryContactId,
    requestTimeoutMs: parsePositiveInt(environment.XENDRA_REQUEST_TIMEOUT_MS, 5_000),
  };
}

export function loadVoiceDispatchConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): VoiceDispatchConfig {
  const voiceProvider = environment.VOICE_PROVIDER?.trim() ?? 'telegram_sandbox';
  if (voiceProvider === 'xendra') return loadXendraVoiceConfig(environment);
  if (voiceProvider === 'retell') return loadRetellVoiceConfig(environment);
  const telegram = loadTelegramAgentBConfig(environment);
  return { ...telegram, voiceProvider: 'telegram_sandbox' };
}

export function loadTelegramAgentBConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
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
  const voiceProvider = environment.VOICE_PROVIDER?.trim() ?? 'telegram_sandbox';
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
