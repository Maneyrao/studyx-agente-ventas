import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { openLocalTestDatabase } from '../helpers/db';
import { sql } from '@/lib/db/orchestrator';
import { sendOutboundMessage } from '@/features/messaging/application/send-outbound-message';
import { PostgresChannelIdentityStore } from '@/features/messaging/adapters/postgres-channel-identity-store';
import {
  AmbiguousChannelError,
  ConfirmedChannelError,
  type MessageChannel,
} from '@/features/messaging/ports/message-channel';

/**
 * Feature 007 — the guarantees the live-call flow rests on.
 *
 * Each scenario here maps to an invariant in
 * `specs/007-direct-outbound-delivery/contracts/send-outbound.contract.md`.
 * They run against a real PostgreSQL because the central promise — one request
 * produces at most one message — is enforced by a unique constraint, and a
 * mocked database would assert the mock rather than the guarantee.
 */

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;

afterAll(async () => {
  await db?.end();
  await sql.end();
});

/** Records every send so a duplicate is visible rather than inferred. */
function recordingChannel(
  channel: 'telegram' | 'whatsapp',
  behaviour: 'accept' | 'permanent' | 'ambiguous' | 'window_closed' | 'transient' = 'accept',
): MessageChannel & { sends: string[] } {
  const sends: string[] = [];
  return {
    channel,
    provider: channel === 'telegram' ? 'telegram' : 'whatsapp_cloud',
    integrationId: `${channel}-test`,
    maxTextLength: 4096,
    sends,
    async sendText(input) {
      sends.push(input.destination);
      if (behaviour === 'permanent') throw new ConfirmedChannelError('permanent', 'BLOCKED');
      if (behaviour === 'transient') throw new ConfirmedChannelError('transient', 'RATE_LIMITED', 7);
      if (behaviour === 'window_closed') throw new ConfirmedChannelError('window_closed', 'WHATSAPP_131047');
      if (behaviour === 'ambiguous') throw new AmbiguousChannelError('TIMEOUT');
      return { providerMessageId: `${input.destination}:1`, acceptedAt: new Date().toISOString() };
    },
  };
}

interface Fixture {
  workspaceId: string;
  contactId: string;
}

async function seedContact(options: {
  telegram?: boolean;
  whatsapp?: boolean;
  whatsappWindow?: 'open' | 'expired';
  consent?: 'granted' | 'revoked';
  lifecycle?: 'active' | 'blocked';
  sandbox?: boolean;
} = {}): Promise<Fixture> {
  const database = db!;
  const suffix = randomUUID().replace(/\D/g, '').slice(0, 9).padEnd(9, '1');
  const phone = `+5491${suffix}`;

  const [workspace] = await database<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, environment, status)
    VALUES (${`ws-${randomUUID().slice(0, 8)}`}, 'Test WS', 'sandbox', 'active')
    RETURNING id
  `;
  // The schema requires a blocked contact to carry when it was blocked
  // (contacts_block_details_check): a block with no timestamp is unauditable.
  const lifecycle = options.lifecycle ?? 'active';
  const [contact] = await database<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin, lifecycle_status, blocked_at)
    VALUES (
      ${phone}, 'whatsapp', ${lifecycle},
      ${lifecycle === 'blocked' ? new Date().toISOString() : null}
    )
    RETURNING id
  `;
  await database`
    INSERT INTO workspace_contacts (workspace_id, contact_id, lifecycle_status)
    VALUES (${workspace.id}::uuid, ${contact.id}::uuid, 'active')
  `;

  if (options.sandbox) {
    await database`
      INSERT INTO sandbox_identities (provider, external_user_id, contact_id, synthetic_phone)
      VALUES ('telegram_sandbox', ${randomUUID()}, ${contact.id}::uuid, ${`+999${suffix}`})
    `;
  }

  for (const channel of ['telegram', 'whatsapp'] as const) {
    const enabled = channel === 'telegram' ? options.telegram : options.whatsapp;
    if (!enabled) continue;

    const destination = channel === 'telegram' ? `tg-${suffix}` : phone;
    const [thread] = await database<Array<{ id: string }>>`
      INSERT INTO channel_threads (contact_id, provider, integration_id, channel, external_conversation_id)
      VALUES (
        ${contact.id}::uuid,
        ${channel === 'telegram' ? 'telegram' : 'whatsapp_cloud'},
        ${`${channel}-test`}, ${channel}, ${destination}
      )
      RETURNING id
    `;
    await database`
      INSERT INTO conversations (contact_id, channel, status, channel_thread_id)
      VALUES (${contact.id}::uuid, ${channel}, 'open', ${thread.id}::uuid)
    `;

    const window = channel === 'whatsapp'
      ? (options.whatsappWindow === 'expired'
        ? new Date(Date.now() - 3_600_000).toISOString()
        : new Date(Date.now() + 3_600_000).toISOString())
      : null;
    await database`
      INSERT INTO contact_channel_permissions (contact_id, channel, consent_status, reply_window_expires_at)
      VALUES (${contact.id}::uuid, ${channel}, ${options.consent ?? 'granted'}, ${window})
    `;
  }

  return { workspaceId: workspace.id, contactId: contact.id };
}

const request = (fixture: Fixture, over: Record<string, unknown> = {}) => ({
  workspaceId: fixture.workspaceId,
  contactId: fixture.contactId,
  text: 'Tu link de pago: https://example.test/pay/abc',
  idempotencyKey: `retell:${randomUUID()}`,
  purpose: 'transactional' as const,
  ...over,
});

run('direct outbound delivery', () => {
  let store: PostgresChannelIdentityStore;

  beforeEach(() => {
    store = new PostgresChannelIdentityStore(db!);
  });

  const deps = (channels: Partial<Record<'telegram' | 'whatsapp', MessageChannel>>) => ({
    identities: store,
    channels,
    preferenceOrder: ['whatsapp', 'telegram'] as Array<'whatsapp' | 'telegram'>,
    db: db!,
  });

  // Scenario 1 — the MVP promise.
  it('delivers through Telegram and records acceptance as submitted', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('sent');
    expect(result.channel).toBe('telegram');
    expect(telegram.sends).toHaveLength(1);

    const [delivery] = await db!<Array<{ state: string; provider_message_id: string }>>`
      SELECT state, provider_message_id FROM outbound_deliveries WHERE id = ${result.deliveryId!}::uuid
    `;
    // `submitted`, not `delivered`: the provider accepted it, nothing confirms
    // a device received it.
    expect(delivery.state).toBe('submitted');
    expect(delivery.provider_message_id).toContain(':');

    const [message] = await db!<Array<{ direction: string; content: string }>>`
      SELECT direction, content FROM messages WHERE contact_id = ${fixture.contactId}::uuid
    `;
    expect(message.direction).toBe('outbound');
  });

  // Scenario 7 — the ambiguity rule.
  it('never reports an ambiguous send as sent', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram', 'ambiguous');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('retryable');
    const [delivery] = await db!<Array<{ state: string }>>`
      SELECT state FROM outbound_deliveries WHERE id = ${result.deliveryId!}::uuid
    `;
    expect(delivery.state).toBe('failed_retryable');
    expect(delivery.state).not.toBe('submitted');
  });

  // Scenario 9 — Telegram message ids are unique per chat, not globally.
  it('keeps provider message ids distinct across two chats', async () => {
    const first = await seedContact({ telegram: true });
    const second = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram');

    const a = await sendOutboundMessage(request(first), deps({ telegram }));
    const b = await sendOutboundMessage(request(second), deps({ telegram }));

    expect(a.outcome).toBe('sent');
    // Without composing the chat id, both would be "1" and the second would
    // collide with UNIQUE (provider, integration_id, provider_message_id).
    expect(b.outcome).toBe('sent');
    expect(a.providerMessageId).not.toBe(b.providerMessageId);
  });

  // Scenario 1 of US2 — replay.
  it('replays the original answer instead of sending twice', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram');
    const payload = request(fixture);

    const first = await sendOutboundMessage(payload, deps({ telegram }));
    const second = await sendOutboundMessage(payload, deps({ telegram }));

    expect(first.outcome).toBe('sent');
    expect(second.outcome).toBe('sent');
    expect(second.providerMessageId).toBe(first.providerMessageId);
    // The contact must receive exactly one message.
    expect(telegram.sends).toHaveLength(1);
  });

  // Scenario 2 — the test that justifies resting on the constraint.
  it('sends exactly once when two concurrent requests share a key', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram');
    const payload = request(fixture);

    const results = await Promise.allSettled([
      sendOutboundMessage(payload, deps({ telegram })),
      sendOutboundMessage(payload, deps({ telegram })),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);
    expect(telegram.sends).toHaveLength(1);
  });

  // Scenario 3 — consent.
  it('refuses a contact whose consent was revoked, without contacting anyone', async () => {
    const fixture = await seedContact({ telegram: true, consent: 'revoked' });
    const telegram = recordingChannel('telegram');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('rejected_by_policy');
    expect(result.reason).toBe('CONSENT_REVOKED');
    expect(telegram.sends).toHaveLength(0);
  });

  it('refuses a blocked contact', async () => {
    const fixture = await seedContact({ telegram: true, lifecycle: 'blocked' });
    const telegram = recordingChannel('telegram');
    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));
    expect(result.outcome).toBe('rejected_by_policy');
    expect(telegram.sends).toHaveLength(0);
  });

  // Scenario 4 — the security gate from the Constitution Check (FR-034).
  it('produces no real side effect for a sandbox contact', async () => {
    const fixture = await seedContact({ telegram: true, sandbox: true });
    const telegram = recordingChannel('telegram');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('rejected_by_policy');
    expect(result.reason).toBe('SANDBOX_LOCKED');
    expect(telegram.sends).toHaveLength(0);
  });

  // Scenario of US3 — tenant isolation.
  it('refuses a contact that belongs to another workspace', async () => {
    const fixture = await seedContact({ telegram: true });
    const other = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram');

    const result = await sendOutboundMessage(
      request({ workspaceId: other.workspaceId, contactId: fixture.contactId }),
      deps({ telegram }),
    );

    expect(result.outcome).toBe('rejected_by_policy');
    expect(result.reason).toBe('CONTACT_NOT_IN_WORKSPACE');
    expect(telegram.sends).toHaveLength(0);
  });

  // Scenario 5 — the fallback that makes cold outreach work at all.
  it('falls back to Telegram when the WhatsApp window has expired', async () => {
    const fixture = await seedContact({ telegram: true, whatsapp: true, whatsappWindow: 'expired' });
    const telegram = recordingChannel('telegram');
    const whatsapp = recordingChannel('whatsapp');

    const result = await sendOutboundMessage(
      request(fixture, { preferredChannel: 'whatsapp' }),
      deps({ telegram, whatsapp }),
    );

    expect(result.outcome).toBe('sent');
    expect(result.channel).toBe('telegram');
    // The expired window is known locally, so WhatsApp is never even attempted.
    expect(whatsapp.sends).toHaveLength(0);
  });

  // Scenario 6 — unreachable is not a failure.
  it('reports unreachable without attempting any provider', async () => {
    const fixture = await seedContact({ whatsapp: true, whatsappWindow: 'expired' });
    const telegram = recordingChannel('telegram');
    const whatsapp = recordingChannel('whatsapp');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram, whatsapp }));

    expect(result.outcome).toBe('unreachable');
    expect(result.reason).toBe('NO_USABLE_CHANNEL');
    expect(whatsapp.sends).toHaveLength(0);
    expect(telegram.sends).toHaveLength(0);
  });

  // Scenario 8 — the provider corrects our optimistic local guess.
  it('switches channel when WhatsApp reports the window already closed', async () => {
    const fixture = await seedContact({ telegram: true, whatsapp: true, whatsappWindow: 'open' });
    const telegram = recordingChannel('telegram');
    const whatsapp = recordingChannel('whatsapp', 'window_closed');

    const result = await sendOutboundMessage(
      request(fixture, { preferredChannel: 'whatsapp' }),
      deps({ telegram, whatsapp }),
    );

    expect(whatsapp.sends).toHaveLength(1);
    expect(result.outcome).toBe('sent');
    expect(result.channel).toBe('telegram');

    // The local window is corrected so the next send does not repeat the trip.
    const [permission] = await db!<Array<{ expired: boolean }>>`
      SELECT reply_window_expires_at <= now() AS expired
      FROM contact_channel_permissions
      WHERE contact_id = ${fixture.contactId}::uuid AND channel = 'whatsapp'
    `;
    expect(permission.expired).toBe(true);
  });

  it('retires an identity the provider permanently rejected', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram', 'permanent');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('permanent');
    const [thread] = await db!<Array<{ unusable_at: string | null; unusable_reason: string | null }>>`
      SELECT unusable_at, unusable_reason FROM channel_threads
      WHERE contact_id = ${fixture.contactId}::uuid AND channel = 'telegram'
    `;
    // Marked, never deleted: it records why the contact became unreachable.
    expect(thread.unusable_at).not.toBeNull();
    expect(thread.unusable_reason).toBeTruthy();
  });

  it('keeps a rate limit retryable on the same ledger row', async () => {
    const fixture = await seedContact({ telegram: true });
    const telegram = recordingChannel('telegram', 'transient');

    const result = await sendOutboundMessage(request(fixture), deps({ telegram }));

    expect(result.outcome).toBe('retryable');
    const [delivery] = await db!<Array<{ state: string; attempt_count: number }>>`
      SELECT state, attempt_count FROM outbound_deliveries WHERE id = ${result.deliveryId!}::uuid
    `;
    expect(delivery.state).toBe('failed_retryable');
  });
});
