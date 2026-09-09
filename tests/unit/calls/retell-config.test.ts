import { describe, expect, it } from 'vitest';
import {
  RETELL_REQUIRED_ENVIRONMENT,
  loadRetellVoiceConfig,
  loadVoiceDispatchConfig,
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
  RETELL_TOOL_SECRET: 'tool-secret',
  RETELL_WEBHOOK_SIGNATURE_KEY: 'webhook-signature-key',
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
      toolSecret: 'tool-secret',
      webhookSignatureKey: 'webhook-signature-key',
      requestTimeoutMs: 4500,
    });
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
