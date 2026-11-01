import { z } from '@botpress/runtime';
import { requestStudyxJson } from '../../utils/http';
import { AGENT_A_BRAIN_PROMPT_VERSION } from '../../prompts/agent-a-brain-v1';
import { STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION } from '../../prompts/studyx-agent-a-canonical.generated';
import { BOTPRESS_EVIDENCE_VERSION, type TurnEvidenceEvent } from './turn-evidence';

export async function persistTurnEvidence(subject: {
  subject_type: 'turn' | 'post_sale'; subject_id: string; trace_id: string;
}, event: TurnEvidenceEvent): Promise<void> {
  await requestStudyxJson({
    path: '/api/agent/evidence',
    body: { ...subject, ...event, botpress_version: BOTPRESS_EVIDENCE_VERSION,
      brain_version: AGENT_A_BRAIN_PROMPT_VERSION, prompt_version: STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION },
    idempotencyKey: `evidence:${subject.subject_type}:${subject.subject_id}:${event.event_id}`,
    traceId: subject.trace_id, responseSchema: z.object({ recorded: z.literal(true) }),
  });
}
