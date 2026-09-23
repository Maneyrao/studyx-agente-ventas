import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from '../../../botpress-agent/src/prompts/studyx-agent-a-canonical.generated';

const source = readFileSync(
  fileURLToPath(new URL('../../../docs/prompts/studyx-agent-a-canonical.md', import.meta.url)),
  'utf8',
);

// Conversational quality is exercised through the vertical/live workflow.
// Exact-prose assertions from v41 would preserve the overloaded prompt.
describe('canonical prompt deployment parity', () => {
  it('loads the same source used to generate the deployed behavior', () => {
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION).toBe('studyx-agent-a-canonical-v46');
    expect(STUDYX_AGENT_A_CANONICAL_PROMPT).toBe(source);
  });
});
