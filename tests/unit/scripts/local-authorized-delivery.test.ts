import { describe, expect, it } from 'vitest';

import {
  deliverAuthorizedLocalOutbound,
  type LocalDeliveryReport,
} from '../../../scripts/lib/local-authorized-delivery';

const UUID = '18a823e8-27c2-4279-9956-058f45f33cd5';

describe('local authorized delivery use case', () => {
  it('reports only a safe failure and produces no response when content was altered', async () => {
    const reports: LocalDeliveryReport[] = [];
    let generatedMessageIds = 0;
    let postDeliveryFlushes = 0;

    const outcome = await deliverAuthorizedLocalOutbound({
      trace_id: UUID,
      outbound: {
        id: UUID,
        content: 'Contenido alterado',
        delivery_attempt: 1,
        authorized_egress: {
          schema_version: 1,
          content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
          authorized_urls: [],
          protected_facts: [],
        },
      },
      createMessageId: () => {
        generatedMessageIds += 1;
        return 'must-not-be-created';
      },
      reportDelivery: async (report) => {
        reports.push(report);
      },
      afterSubmitted: async () => {
        postDeliveryFlushes += 1;
      },
    });

    expect(outcome).toEqual({ kind: 'blocked', reason: 'HASH_MISMATCH' });
    expect(reports).toEqual([{
      outbound_id: UUID,
      trace_id: UUID,
      status: 'failed',
      botpress_message_id: null,
      replayed: false,
      error_code: 'EGRESS_HASH_MISMATCH',
      delivery_attempt: 1,
    }]);
    expect(generatedMessageIds).toBe(0);
    expect(postDeliveryFlushes).toBe(0);
  });

  it('reports one submission and exposes content only after exact verification', async () => {
    const reports: LocalDeliveryReport[] = [];
    let postDeliveryFlushes = 0;

    const outcome = await deliverAuthorizedLocalOutbound({
      trace_id: UUID,
      outbound: {
        id: UUID,
        content: 'Contenido autorizado',
        delivery_attempt: 2,
        authorized_egress: {
          schema_version: 1,
          content_hash: 'e2dee359447348131358a63664853c018f5db0fcb31835e30a0aac56badab6bd',
          authorized_urls: [],
          protected_facts: [],
        },
      },
      createMessageId: () => 'local-eval-message-1',
      reportDelivery: async (report) => {
        reports.push(report);
      },
      afterSubmitted: async () => {
        postDeliveryFlushes += 1;
      },
    });

    expect(outcome).toEqual({
      kind: 'submitted',
      content: 'Contenido autorizado',
      message_id: 'local-eval-message-1',
    });
    expect(reports).toEqual([{
      outbound_id: UUID,
      trace_id: UUID,
      status: 'submitted_to_botpress',
      botpress_message_id: 'local-eval-message-1',
      replayed: false,
      error_code: null,
      delivery_attempt: 2,
    }]);
    expect(postDeliveryFlushes).toBe(1);
  });
});
