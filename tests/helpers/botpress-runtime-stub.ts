/**
 * Test stub for `@botpress/runtime`, wired via a resolve alias in
 * `vitest.config.mts`. The real package only resolves from
 * `botpress-agent/node_modules` and cannot load under vitest (broken ESM
 * subpath in a transitive dependency), so unit tests that exercise
 * botpress-agent source get this minimal, side-effect-free surface instead.
 */
import { z } from 'zod';

export { z };

type RuntimeHandler = {
  bivarianceHack(input: unknown): unknown;
}['bivarianceHack'];

interface ConversationDefinition {
  readonly channel: string;
  readonly handler: RuntimeHandler;
}

interface WorkflowDefinition {
  readonly handler: RuntimeHandler;
}

/** Mirrors `new Conversation({ channel, handler })`: just records the definition. */
export class Conversation<TDefinition extends ConversationDefinition = ConversationDefinition> {
  definition: TDefinition;
  constructor(definition: TDefinition & ConversationDefinition) {
    this.definition = definition;
  }
}

/** Records workflow definitions so orchestration behavior can run in unit tests. */
export class Workflow<TDefinition extends WorkflowDefinition = WorkflowDefinition> {
  definition: TDefinition;
  constructor(definition: TDefinition & WorkflowDefinition) {
    this.definition = definition;
  }

  async getOrCreate(_input: unknown): Promise<{ id: string }> {
    void _input;
    return { id: 'test-workflow-id' };
  }
}

/** Records action definitions so their handlers can be exercised in unit tests. */
export class Action<TDefinition = unknown, TOutput = unknown> {
  definition: TDefinition;
  declare readonly __output?: TOutput;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }

  async execute(_input: unknown): Promise<TOutput> {
    void _input;
    throw new Error('ACTION_EXECUTE_NOT_CONFIGURED');
  }
}

/** Minimal structured-exit surface used by workflow generation tests. */
class Exit<TDefinition = unknown> {
  definition: TDefinition;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }
}

export const Autonomous = { Exit };

export const context = {
  get(key: string): string {
    return key === 'botId' ? 'test-bot-id' : '';
  },
};

/** Mutable per-test agent configuration; tests read/override as needed. */
export const configuration: {
  emulatorPhoneE164: string;
  apiBaseUrl: string;
  orchestratorKeyId: string;
  requestTimeoutMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  automationEnabled: boolean;
  decisionProvider: 'botpress_managed' | 'gemini_direct' | 'groq_direct';
  geminiDecisionModel: string;
  groqDecisionModel: string;
  agentABrainModel: string;
  agentABrainOpenAIModel: string;
  agentABrainOpenAIFallbackModel: string;
  [key: string]: unknown;
} = {
  emulatorPhoneE164: '+59891234567',
  apiBaseUrl: 'http://studyx.test',
  orchestratorKeyId: 'botpress-test',
  requestTimeoutMs: 2000,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
  automationEnabled: true,
  decisionProvider: 'botpress_managed',
  geminiDecisionModel: 'gemini-test',
  groqDecisionModel: 'groq-test',
  agentABrainModel: 'openai/gpt-oss-120b',
  agentABrainOpenAIModel: 'gpt-5.6-terra',
  agentABrainOpenAIFallbackModel: 'gpt-5.6-luna',
};

/** Test doubles for agent secrets; never real values. */
export const secrets: Record<string, string> = {
  STUDYX_ORCHESTRATOR_KEY: 'test-orchestrator-key',
  STUDYX_SIGNING_SECRET: 'test-signing-secret',
};
