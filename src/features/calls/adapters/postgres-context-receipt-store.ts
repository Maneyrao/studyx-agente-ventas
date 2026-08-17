import { createHash } from 'node:crypto';
import type postgres from 'postgres';
import { ContextLoadAckV1Schema } from '../domain/context-receipt';
import type {
  ContextReceiptRecord,
  ContextReceiptStore,
  ReserveContextReceiptInput,
  TelegramSmokeBindingStore,
} from '../ports/context-receipt-store';

type ReceiptRow = {
  id: string; call_id: string; idempotency_key: string; context_hash_hex: string; ack: unknown;
  telegram_chat_id: string; telegram_user_id: string; telegram_message_id: string | null;
  nonce_hash_hex: string; expires_at: Date | string; created_at: Date | string;
  delivery_status: ContextReceiptRecord['deliveryStatus']; verdict: ContextReceiptRecord['verdict'];
  verified_at: Date | string | null;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapReceipt(row: ReceiptRow): ContextReceiptRecord {
  return {
    id: row.id,
    callId: row.call_id,
    idempotencyKey: row.idempotency_key,
    contextHash: row.context_hash_hex,
    ack: ContextLoadAckV1Schema.parse(row.ack),
    telegramChatId: row.telegram_chat_id,
    telegramUserId: row.telegram_user_id,
    telegramMessageId: row.telegram_message_id,
    nonceHash: row.nonce_hash_hex,
    expiresAt: toIso(row.expires_at),
    createdAt: toIso(row.created_at),
    deliveryStatus: row.delivery_status,
    verdict: row.verdict,
    verifiedAt: row.verified_at ? toIso(row.verified_at) : null,
  };
}

const RECEIPT_COLUMNS = `
  id, call_id, idempotency_key, encode(context_hash, 'hex') AS context_hash_hex, ack,
  telegram_chat_id, telegram_user_id, telegram_message_id,
  encode(nonce_hash, 'hex') AS nonce_hash_hex, expires_at, created_at,
  delivery_status, verdict, verified_at
`;

export class PostgresContextReceiptStore implements ContextReceiptStore, TelegramSmokeBindingStore {
  constructor(
    private readonly db: postgres.Sql,
    private readonly target: { expectedChatId: string; expectedUserId: string },
  ) {}

  async reserve(input: ReserveContextReceiptInput): Promise<{ created: boolean; receipt: ContextReceiptRecord }> {
    return this.db.begin(async (tx) => {
      const inserted = await tx<Array<ReceiptRow>>`
        INSERT INTO call_context_receipts (
          call_id, idempotency_key, context_hash, ack, delivery_status,
          telegram_chat_id, telegram_user_id, nonce_hash, expires_at, created_at
        ) VALUES (
          ${input.callId}::uuid, ${input.idempotencyKey}, decode(${input.contextHash}, 'hex'),
          ${tx.json(input.ack)}, 'pending', ${input.telegramChatId}, ${input.telegramUserId},
          decode(${input.nonceHash}, 'hex'), ${input.expiresAt}::timestamptz, ${input.createdAt}::timestamptz
        )
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING ${tx.unsafe(RECEIPT_COLUMNS)}
      `;
      if (inserted[0]) return { created: true, receipt: mapReceipt(inserted[0]) };
      const existing = await tx<Array<ReceiptRow>>`
        SELECT ${tx.unsafe(RECEIPT_COLUMNS)}
        FROM call_context_receipts WHERE idempotency_key = ${input.idempotencyKey}
        FOR UPDATE
      `;
      if (!existing[0]) throw new Error('CONTEXT_RECEIPT_RESERVATION_LOST');
      const receipt = mapReceipt(existing[0]);
      if (
        receipt.callId !== input.callId
        || receipt.contextHash !== input.contextHash
        || receipt.telegramChatId !== input.telegramChatId
        || receipt.telegramUserId !== input.telegramUserId
      ) throw new Error('CONTEXT_RECEIPT_REPLAY_CONFLICT');
      return { created: false, receipt };
    });
  }

  async markAccepted(receiptId: string, telegramMessageId: string, acceptedAt?: string, latencyMs?: number): Promise<void> {
    await this.db`
      UPDATE call_context_receipts
      SET delivery_status = 'accepted', telegram_message_id = ${telegramMessageId},
          telegram_accepted_at = ${acceptedAt ?? new Date().toISOString()}::timestamptz,
          request_to_telegram_accepted_ms = ${latencyMs ?? null}, error_code = NULL
      WHERE id = ${receiptId}::uuid AND delivery_status = 'pending'
    `;
  }

  async markAmbiguous(receiptId: string, errorCode = 'TELEGRAM_SEND_AMBIGUOUS'): Promise<void> {
    await this.db`
      UPDATE call_context_receipts SET delivery_status = 'ambiguous', error_code = ${errorCode}
      WHERE id = ${receiptId}::uuid AND delivery_status = 'pending'
    `;
  }

  async markFailed(receiptId: string, errorCode = 'TELEGRAM_SEND_FAILED'): Promise<void> {
    await this.db`
      UPDATE call_context_receipts SET delivery_status = 'failed', error_code = ${errorCode}
      WHERE id = ${receiptId}::uuid AND delivery_status = 'pending'
    `;
  }

  async findByCallback(input: {
    nonceHash: string; telegramChatId: string; telegramUserId: string; telegramMessageId: string;
  }): Promise<ContextReceiptRecord | null> {
    const rows = await this.db<Array<ReceiptRow>>`
      SELECT ${this.db.unsafe(RECEIPT_COLUMNS)}
      FROM call_context_receipts
      WHERE nonce_hash = decode(${input.nonceHash}, 'hex')
        AND telegram_chat_id = ${input.telegramChatId}
        AND telegram_user_id = ${input.telegramUserId}
        AND telegram_message_id = ${input.telegramMessageId}
      LIMIT 1
    `;
    return rows[0] ? mapReceipt(rows[0]) : null;
  }

  async recordVerdict(input: {
    receiptId: string; verdict: 'correct' | 'incorrect'; callbackQueryId: string;
    updateId: string; verifiedAt: string;
  }): Promise<'recorded' | 'duplicate' | 'conflict'> {
    return this.db.begin(async (tx) => {
      const rows = await tx<Array<{ verdict: 'correct' | 'incorrect' | null; callback_update_id: string | null }>>`
        SELECT verdict, callback_update_id FROM call_context_receipts
        WHERE id = ${input.receiptId}::uuid FOR UPDATE
      `;
      const row = rows[0];
      if (!row) return 'conflict' as const;
      if (row.verdict !== null) return row.verdict === input.verdict ? 'duplicate' as const : 'conflict' as const;
      const callbackHash = createHash('sha256').update(input.callbackQueryId, 'utf8').digest('hex');
      try {
        await tx`
          UPDATE call_context_receipts
          SET verdict = ${input.verdict}, callback_update_id = ${input.updateId},
              callback_query_id_hash = decode(${callbackHash}, 'hex'), verified_at = ${input.verifiedAt}::timestamptz
          WHERE id = ${input.receiptId}::uuid
        `;
      } catch (error) {
        if (error instanceof Error && 'code' in error && (error as Error & { code?: string }).code === '23505') return 'conflict' as const;
        throw error;
      }
      return 'recorded' as const;
    });
  }

  async registerBinding(input: { chatId: string; userId: string; startedAt: string }): Promise<'registered' | 'duplicate'> {
    if (input.chatId !== this.target.expectedChatId || input.userId !== this.target.expectedUserId) {
      throw new Error('TELEGRAM_TESTER_NOT_AUTHORIZED');
    }
    const existing = await this.db<Array<{ id: string }>>`
      SELECT id FROM telegram_agent_b_bindings
      WHERE telegram_chat_id = ${input.chatId} AND telegram_user_id = ${input.userId}
    `;
    if (existing[0]) {
      await this.db`UPDATE telegram_agent_b_bindings SET status = 'active', last_started_at = ${input.startedAt}::timestamptz, updated_at = now() WHERE id = ${existing[0].id}::uuid`;
      return 'duplicate';
    }
    await this.db`
      INSERT INTO telegram_agent_b_bindings (telegram_chat_id, telegram_user_id, first_started_at, last_started_at)
      VALUES (${input.chatId}, ${input.userId}, ${input.startedAt}::timestamptz, ${input.startedAt}::timestamptz)
    `;
    return 'registered';
  }

  async resolve(callId: string, phoneE164: string): Promise<{ chatId: string; userId: string }> {
    const rows = await this.db<Array<{ telegram_chat_id: string; telegram_user_id: string }>>`
      SELECT b.telegram_chat_id, b.telegram_user_id
      FROM call_sessions AS cs
      JOIN contacts AS c ON c.id = cs.contact_id
      JOIN sandbox_identities AS si ON si.contact_id = cs.contact_id AND si.provider = 'telegram_sandbox'
      JOIN telegram_agent_b_bindings AS b
        ON b.telegram_chat_id = ${this.target.expectedChatId}
       AND b.telegram_user_id = ${this.target.expectedUserId}
       AND b.status = 'active'
      WHERE cs.id = ${callId}::uuid AND cs.provider = 'telegram_sandbox' AND c.phone = ${phoneE164}
      LIMIT 1
    `;
    if (!rows[0]) throw new Error('TELEGRAM_AGENT_B_NOT_STARTED');
    return { chatId: rows[0].telegram_chat_id, userId: rows[0].telegram_user_id };
  }
}
