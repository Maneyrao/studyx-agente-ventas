/**
 * Test stub for `@botpress/runtime`, wired via a resolve alias in
 * `vitest.config.mts`. The real package only resolves from
 * `botpress-agent/node_modules` and cannot load under vitest (broken ESM
 * subpath in a transitive dependency), so unit tests that exercise
 * botpress-agent source get this minimal, side-effect-free surface instead.
 */
import { z } from 'zod';

export { z };

/** Mirrors `new Conversation({ channel, handler })`: just records the definition. */
export class Conversation<TDefinition = unknown> {
  definition: TDefinition;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }
}

/** Records workflow definitions so orchestration behavior can run in unit tests. */
export class Workflow<TDefinition = unknown> {
  definition: TDefinition;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }
}

/** Records action definitions so their handlers can be exercised in unit tests. */
export class Action<TDefinition = unknown, TOutput = unknown> {
  definition: TDefinition;
  declare readonly __output?: TOutput;
  constructor(definition: TDefinition) {
    this.definition = definition;
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
  [key: string]: unknown;
} = {
  emulatorPhoneE164: '+59891234567',
  apiBaseUrl: 'http://studyx.test',
  orchestratorKeyId: 'botpress-test',
  requestTimeoutMs: 2000,
  retryBaseDelayMs: 1,
  retryMaxDelayMs: 2,
};

/** Test doubles for agent secrets; never real values. */
export const secrets: Record<string, string> = {
  STUDYX_ORCHESTRATOR_KEY: 'test-orchestrator-key',
  STUDYX_SIGNING_SECRET: 'test-signing-secret',
};
