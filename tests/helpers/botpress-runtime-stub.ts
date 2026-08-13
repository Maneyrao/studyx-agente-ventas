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

/** Mutable per-test agent configuration; tests read/override as needed. */
export const configuration: { emulatorPhoneE164: string; [key: string]: unknown } = {
  emulatorPhoneE164: '+59891234567',
};
