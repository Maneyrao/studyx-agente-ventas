import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { sql } from '@/lib/db/orchestrator';
import { processInboundMessage, type InboundEnvelope } from '@/lib/services/ingestion.service';
import { persistedInboundReceipts } from '@/lib/services/inbound-receipts.service';

afterAll(async () => { await sql.end(); });
const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
run('canonical receipt completeness', () => {
  it('reports only persisted messages in the exact conversation and workspace', async () => {
    const id = randomUUID();
    const input: InboundEnvelope = { schema_version: 1, source: 'botpress', channel: 'emulator',
      integration_id: 'receipt-test', external_conversation_id: id, external_message_id: randomUUID(),
      external_user_id: id, phone_e164: `+999${Date.now().toString().slice(-10)}`,
      trace_id: randomUUID(), message: { type: 'text', text: 'Una pregunta', occurred_at: new Date().toISOString(),
        reply_to_external_message_id: null } };
    await processInboundMessage(input);
    const missing = randomUUID();
    const query = { integration_id: input.integration_id, external_conversation_id: id,
      channel: 'emulator' as const, external_message_ids: [input.external_message_id, missing], sandbox_provider: null };
    expect(await persistedInboundReceipts(query)).toEqual([input.external_message_id]);
    expect(await persistedInboundReceipts({ ...query, external_conversation_id: randomUUID() })).toEqual([]);
    expect(await persistedInboundReceipts({ ...query, workspaceSlug: 'another-workspace' })).toEqual([]);
  });
});
