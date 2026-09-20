import { describe, expect, it } from 'vitest';
import {
  RETELL_REQUIRED_ENVIRONMENT,
  loadRetellVoiceConfig,
  loadVoiceDispatchConfig,
  loadXendraVoiceConfig,
} from '@/lib/config';

const complete = {
  VOICE_PROVIDER: 'retell',
  RETELL_API_KEY: 'retell-api-key',
  RETELL_FROM_NUMBER: '+14155550123',
  RETELL_API_BASE_URL: 'https://api.retellai.com/',
  RETELL_AGENT_ID: 'agent_d2c1a4ac7900ae95a47727156b',
  RETELL_AGENT_VERSION: '0',
  RETELL_LLM_ID: 'llm_eea8f670b6569b44689e9394b150',
  RETELL_LLM_VERSION: '0',
  RETELL_ADVISOR_NAME: 'Sofía',
  RETELL_TOOLS_SECRET: 'tools-secret',
  RETELL_REQUEST_TIMEOUT_MS: '4500',
} satisfies Readonly<Record<string, string | undefined>>;

describe('loadRetellVoiceConfig', () => {
  it('loads an explicit numeric Agent and LLM version policy', () => {
    expect(loadRetellVoiceConfig(complete)).toEqual({
      voiceProvider: 'retell',
      apiKey: 'retell-api-key',
      fromNumber: '+14155550123',
      apiBaseUrl: 'https://api.retellai.com',
      agentId: 'agent_d2c1a4ac7900ae95a47727156b',
      agentVersion: 0,
      llmId: 'llm_eea8f670b6569b44689e9394b150',
      llmVersion: 0,
      advisorName: 'Sofía',
      toolsSecret: 'tools-secret',
      requestTimeoutMs: 4500,
    });
  });

  it('uses apiKey for future webhook verification and requires only the approved names', () => {
    const loaded = loadRetellVoiceConfig(complete);
    expect(loaded.apiKey).toBe('retell-api-key');
    expect(RETELL_REQUIRED_ENVIRONMENT).toEqual([
      'RETELL_API_KEY',
      'RETELL_FROM_NUMBER',
      'RETELL_API_BASE_URL',
      'RETELL_AGENT_ID',
      'RETELL_AGENT_VERSION',
      'RETELL_LLM_ID',
      'RETELL_LLM_VERSION',
      'RETELL_ADVISOR_NAME',
      'RETELL_TOOLS_SECRET',
    ]);
  });

  it.each(RETELL_REQUIRED_ENVIRONMENT)('fails by variable name when %s is absent', (missing) => {
    expect(() => loadRetellVoiceConfig({ ...complete, [missing]: '  ' }))
      .toThrow(`MISSING_RETELL_CONFIG:${missing}`);
  });

  it.each([
    ['RETELL_FROM_NUMBER', '555-1234'],
    ['RETELL_API_BASE_URL', 'http://api.retellai.com'],
    ['RETELL_AGENT_ID', 'latest'],
    ['RETELL_AGENT_VERSION', 'latest'],
    ['RETELL_LLM_ID', 'llm'],
    ['RETELL_LLM_VERSION', '-1'],
  ])('rejects invalid %s without including its value', (name, value) => {
    expect(() => loadRetellVoiceConfig({ ...complete, [name]: value }))
      .toThrow(`INVALID_RETELL_CONFIG:${name}`);
  });

  it('selects Retell without requiring Telegram sandbox credentials', () => {
    expect(loadVoiceDispatchConfig(complete).voiceProvider).toBe('retell');
  });
});

describe('loadXendraVoiceConfig', () => {
  const xendra = {
    VOICE_PROVIDER: 'xendra',
    XENDRA_CALL_URL: 'https://xendrapro-admin.vercel.app/api/studyx/llamar',
    XENDRA_ORCHESTRATOR_SECRET: 'orchestrator-secret',
    XENDRA_ADVISOR_NAME: 'Sofía',
    XENDRA_CLOSER_NUMBER: '+5491144445555',
    XENDRA_REQUEST_TIMEOUT_MS: '3500',
  } satisfies Readonly<Record<string, string | undefined>>;

  it('selects Xendra without requiring Telegram or Retell credentials', () => {
    expect(loadVoiceDispatchConfig(xendra)).toEqual({
      voiceProvider: 'xendra',
      callUrl: 'https://xendrapro-admin.vercel.app/api/studyx/llamar',
      orchestratorSecret: 'orchestrator-secret',
      advisorName: 'Sofía',
      closerNumber: '+5491144445555',
      telegramCanaryContactIds: [],
      requestTimeoutMs: 3500,
    });
  });

  it('requires only the dispatch URL and shared secret; optional variables default empty', () => {
    expect(loadXendraVoiceConfig({
      VOICE_PROVIDER: 'xendra',
      XENDRA_CALL_URL: xendra.XENDRA_CALL_URL,
      XENDRA_ORCHESTRATOR_SECRET: xendra.XENDRA_ORCHESTRATOR_SECRET,
    })).toEqual({
      voiceProvider: 'xendra',
      callUrl: xendra.XENDRA_CALL_URL,
      orchestratorSecret: xendra.XENDRA_ORCHESTRATOR_SECRET,
      advisorName: '',
      closerNumber: '',
      telegramCanaryContactIds: [],
      requestTimeoutMs: 5000,
    });
  });

  it('accepts an exact list of Telegram canary contacts and rejects malformed values', () => {
    const lucas = '55c26c0f-90e1-4d5f-8298-da62e77f5b38';
    const thiago = '2cfa8868-eac2-4985-951f-37b2b2dee739';
    expect(loadXendraVoiceConfig({
      ...xendra,
      XENDRA_TELEGRAM_CANARY_CONTACT_IDS: `${lucas}, ${thiago}`,
    }).telegramCanaryContactIds).toEqual([lucas, thiago]);
    expect(() => loadXendraVoiceConfig({
      ...xendra,
      XENDRA_TELEGRAM_CANARY_CONTACT_IDS: `${lucas},all`,
    })).toThrow('INVALID_XENDRA_CONFIG:XENDRA_TELEGRAM_CANARY_CONTACT_IDS');
  });

  it.each(['XENDRA_CALL_URL', 'XENDRA_ORCHESTRATOR_SECRET'])(
    'fails by variable name when %s is absent',
    (missing) => {
      expect(() => loadXendraVoiceConfig({ ...xendra, [missing]: '  ' }))
        .toThrow(`MISSING_XENDRA_CONFIG:${missing}`);
    },
  );

  it.each([
    'http://xendra.example/api/studyx/llamar',
    'https://user:password@xendra.example/api/studyx/llamar',
    'https://xendra.example/api/studyx/llamar?secret=value',
    'https://xendra.example/api/studyx/llamar#fragment',
  ])('rejects unsafe external Xendra URL %s without echoing it', (url) => {
    expect(() => loadXendraVoiceConfig({ ...xendra, XENDRA_CALL_URL: url }))
      .toThrow('INVALID_XENDRA_CONFIG:XENDRA_CALL_URL');
  });

  it('allows an HTTP loopback URL for the no-call local fake', () => {
    expect(loadXendraVoiceConfig({
      ...xendra,
      XENDRA_CALL_URL: 'http://127.0.0.1:43123/api/studyx/llamar',
    }).callUrl).toBe('http://127.0.0.1:43123/api/studyx/llamar');
  });
});
