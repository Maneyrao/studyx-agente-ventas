import { describe, expect, it } from 'vitest';
import { observeWorkflowConsoleInfoV1, type WorkflowEventV1 } from '../helpers/agent-a-workflow-events';

describe('eventos del workflow por trace', () => {
  it('conserva repaired/attempted y fallos del trace propio, pasando todos los logs al destino original', () => {
    const events: WorkflowEventV1[] = [];
    const originalOutput: unknown[][] = [];
    const observed = observeWorkflowConsoleInfoV1((...args) => { originalOutput.push(args); }, 'trace-1', events);
    observed(JSON.stringify({ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: 'trace-1', repair_attempted: true, repaired: false, rejection_codes: ['MISSING_INTAKE'] }));
    observed(JSON.stringify({ event: 'studyx.turn.agent_a_brain_v1', trace_id: 'trace-1', brain_source: 'fallback', brain_failure_reason: 'provider_unavailable' }));
    observed(JSON.stringify({ event: 'studyx.turn.agent_a_plannerless_v2', trace_id: 'otro-trace', repaired: true }));
    observed('texto no estructurado');
    observed(JSON.stringify({ event: 'another.logger', trace_id: 'trace-1' }));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ repair_attempted: true, repaired: false, rejection_codes: ['MISSING_INTAKE'] });
    expect(events[1]).toMatchObject({ brain_source: 'fallback' });
    expect(originalOutput).toHaveLength(5);
  });
});
