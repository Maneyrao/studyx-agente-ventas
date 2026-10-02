import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const workflowSource = readFileSync(
  fileURLToPath(new URL('../../../botpress-agent/src/workflows/processInboundTurn.ts', import.meta.url)),
  'utf8',
);

/**
 * When the model owns the copy, a provider outage does not license another
 * component to invent sales prose. Both model-owned routes use the same
 * neutral continuity acknowledgement instead of lexical or catalog-authored
 * sales substitutes.
 * The conversation-pipeline route used to disagree — it called
 * `modelUnavailableFallback`, a nine-regex engine over the customer's own text
 * that produced greetings, identity lines and price answers. Two behaviours
 * for the same event is the defect; these tests pin them together.
 */
describe('brain unavailable is one behaviour, not two', () => {
  it('uses no backend-authored state or catalog reply before continuity acknowledgement', () => {
    const stateFallbacks = workflowSource.match(/policyRejectedStateFallback\(owned\)/gu);
    const canonicalFallbacks = workflowSource.match(/routeCanonicalCatalogFailureFallback\(owned\)/gu);
    const technicalAcknowledgements = workflowSource.match(/technicalFallback\(/gu);

    expect(stateFallbacks).toBeNull();
    expect(canonicalFallbacks).toBeNull();
    expect(technicalAcknowledgements?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it('never routes a brain failure into the lexical fallback engine', () => {
    const pipelineFailureAssignments = workflowSource.match(/pipelineFailureDecision = .+/gu) ?? [];

    expect(pipelineFailureAssignments).not.toHaveLength(0);
    for (const assignment of pipelineFailureAssignments) {
      expect(assignment).not.toContain('modelUnavailableFallback');
    }
  });

  it('confines the lexical fallback engine to the single legacy call site', () => {
    // `modelUnavailableFallback` still serves the pre-pipeline route, which is
    // retired in its own plan. Until then this count is the containment gate:
    // it fails the moment the engine is wired back into a model-owned path.
    const callSites = workflowSource.match(/modelUnavailableFallback\(/gu);

    expect(callSites).toHaveLength(1);
  });
});
