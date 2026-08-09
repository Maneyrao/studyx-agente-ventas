import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import {
  processInboundMessage,
  type InboundEnvelope,
} from '@/lib/services/ingestion.service';
import { getRecentMessages } from '@/lib/services/memory.service';

// Phase 5 done gate: 50 concurrent messages fan out to 5 distinct contacts;
// each contact's getRecentMessages() must return exactly its own 10 messages,
// in ascending chronological order, with zero cross-contact contamination.

const databaseInspection = process.env.TEST_DATABASE_URL;
const run = databaseInspection ? describe : describe.skip;
const db = databaseInspection ? openLocalTestDatabase() : null;

const CONTACT_COUNT = 5;
const MESSAGES_PER_CONTACT = 10;

function envelopeFor(contactIndex: number, messageIndex: number): InboundEnvelope {
  const phone = `+549115${String(contactIndex).padStart(7, '0')}`;
  const externalConversationId = `conv-c${contactIndex}`;
  return {
    schema_version: 1,
    source: 'botpress',
    channel: 'emulator',
    integration_id: 'vitest-emulator',
    external_message_id: `msg-c${contactIndex}-m${messageIndex}-${randomUUID()}`,
    external_conversation_id: externalConversationId,
    external_user_id: `user-c${contactIndex}`,
    phone_e164: phone,
    trace_id: randomUUID(),
    message: {
      type: 'text',
      text: `Contact ${contactIndex} message ${messageIndex}`,
      occurred_at: new Date(Date.now() + messageIndex).toISOString(),
      reply_to_external_message_id: null,
    },
  };
}

run('memory context — 50-message concurrency', () => {
  afterAll(async () => {
    if (db) await db.end();
  });

  it('returns each contact its own recent turns in chronological order, never mixing contacts', async () => {
    // Fan out: build 50 envelopes intercalating contacts so the concurrent
    // Promise.all cannot rely on serial ordering to succeed.
    const jobs: Array<{ contactIndex: number; messageIndex: number; envelope: InboundEnvelope }> = [];
    for (let m = 0; m < MESSAGES_PER_CONTACT; m++) {
      for (let c = 0; c < CONTACT_COUNT; c++) {
        jobs.push({ contactIndex: c, messageIndex: m, envelope: envelopeFor(c, m) });
      }
    }
    expect(jobs).toHaveLength(CONTACT_COUNT * MESSAGES_PER_CONTACT);

    // Execute all 50 in parallel.
    const results = await Promise.all(jobs.map((j) => processInboundMessage(j.envelope)));
    expect(results).toHaveLength(CONTACT_COUNT * MESSAGES_PER_CONTACT);

    // Group persisted turns by contact_id (from the ingest response, not the
    // envelope) — proves resolveContact deduped by phone as expected.
    const byContact = new Map<string, string[]>();
    const conversationByContact = new Map<string, string>();
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const arr = byContact.get(r.contact.id) ?? [];
      arr.push(r.turn_id);
      byContact.set(r.contact.id, arr);
      conversationByContact.set(r.contact.id, r.conversation_id);
    }

    expect(byContact.size).toBe(CONTACT_COUNT);
    for (const turnIds of byContact.values()) {
      expect(turnIds).toHaveLength(MESSAGES_PER_CONTACT);
    }

    // For each contact, getRecentMessages(conversation_id) must return
    // exactly its 10 messages, ordered ASC by created_at (ties broken by id).
    for (const [contactId, expectedTurnIds] of byContact) {
      const conversationId = conversationByContact.get(contactId)!;
      const { messages } = await getRecentMessages({
        conversation_id: conversationId,
        limit: MESSAGES_PER_CONTACT,
      });

      expect(messages, `contact=${contactId}`).toHaveLength(MESSAGES_PER_CONTACT);

      // Isolation: every returned message must belong to this contact only.
      for (const msg of messages) {
        expect(
          expectedTurnIds.includes(msg.id),
          `contact=${contactId} leaked message id=${msg.id}`,
        ).toBe(true);
      }

      // Chronological ASC (non-decreasing created_at).
      for (let i = 1; i < messages.length; i++) {
        expect(
          new Date(messages[i].created_at).getTime() >=
            new Date(messages[i - 1].created_at).getTime(),
          `contact=${contactId} out-of-order at index=${i}`,
        ).toBe(true);
      }
    }
  });
});
