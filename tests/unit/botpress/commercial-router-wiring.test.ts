import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const WORKFLOW = new URL(
  '../../../botpress-agent/src/workflows/processInboundTurn.ts',
  import.meta.url,
);
const RUNNER = new URL('../../../scripts/run-agent-a-conversations.ts', import.meta.url);

const LEGACY_DIRECT_MATCHERS = /match(?:CallHandoff|PaymentSelection|ContactCapture|CourseFacts|ConversationClose|CourseDiscovery|DeterministicGreeting)/u;

describe('commercial router wiring parity', () => {
  it.each([
    ['Botpress workflow', WORKFLOW, "from '../utils/commercial-router'"],
    ['local runner', RUNNER, "from '../botpress-agent/src/utils/commercial-router'"],
  ])('%s delegates capability ordering to the shared router', async (_name, file, expectedImport) => {
    const source = await readFile(file, 'utf8');

    expect(source).toContain(expectedImport);
    expect(source).toContain('routeCommercialTurn({');
    expect(source).not.toMatch(LEGACY_DIRECT_MATCHERS);
  });

  it.each([
    ['Botpress workflow', WORKFLOW],
    ['local runner', RUNNER],
  ])('%s applies the final decision policy exactly once', async (_name, file) => {
    const source = await readFile(file, 'utf8');
    const callSites = source.match(/\bapplyDecisionPolicy\s*\(/gu) ?? [];

    expect(callSites).toHaveLength(1);
  });
});
