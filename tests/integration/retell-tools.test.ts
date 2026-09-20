import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { PostgresCallStore } from '@/features/calls/adapters/postgres-call-store';
import { PostgresRetellContactToolStore } from '@/features/calls/adapters/postgres-retell-tools';
import { mapRetellLifecycleEvent } from '@/features/calls/adapters/retell-lifecycle';
import { handleRetellToolRequest } from '@/features/calls/application/retell-tools';
import { recordCallEvent } from '@/features/calls/application/record-call-event';
import { hashCallContext } from '@/features/calls/domain/call-context';
import { PostgresBusinessContextStore } from '@/features/orchestration/adapters/postgres-business-context';
import { agentALeadProjectionSourceOrder, enqueueLeadProjection, leadProjectionKey } from '@/lib/services/projection.service';
import { openIndependentLocalTestDatabases, openLocalTestDatabase } from '../helpers/db';

const run = process.env.TEST_DATABASE_URL ? describe : describe.skip;
const db = process.env.TEST_DATABASE_URL ? openLocalTestDatabase() : null;
afterAll(async () => db?.end());

const apiKey = 'retell-tool-integration-api-key';
const toolsSecret = 'retell-tool-integration-secret';
const nowMs = 1_788_966_000_000;

async function fixture(input: {
  name?: string | null;
  email?: string | null;
  sourceOrder?: number;
} = {}) {
  const workspaceSlug = `retell-tools-${randomUUID()}`;
  const paymentOptions = [
    { code: 'monthly_12', currency: 'USD', total_amount: '360.00', installments: 12, installment_amount: '30.00', payment_link: 'https://buy.stripe.com/test-12' },
    { code: 'monthly_6', currency: 'USD', total_amount: '360.00', installments: 6, installment_amount: '60.00', payment_link: 'https://buy.stripe.com/test-6' },
    { code: 'one_time', currency: 'USD', total_amount: '360.00', installments: 1, installment_amount: '360.00', payment_link: 'https://buy.stripe.com/test-once' },
  ];
  const workspaces = await db!<Array<{ id: string }>>`
    INSERT INTO workspaces (slug, display_name, metadata)
    VALUES (${workspaceSlug}, 'Retell Tool Test', ${db!.json({ payment_options: paymentOptions })})
    RETURNING id
  `;
  const workspaceId = workspaces[0].id;
  const phone = `+54911${randomUUID().replace(/\D/gu, '').padEnd(8, '1').slice(0, 8)}`;
  const contacts = await db!<Array<{ id: string }>>`
    INSERT INTO contacts (phone, channel_origin, name, email)
    VALUES (${phone}, 'whatsapp', ${input.name ?? null}, ${input.email ?? null})
    RETURNING id
  `;
  const contactId = contacts[0].id;
  await db!`
    INSERT INTO workspace_contacts (workspace_id, contact_id)
    VALUES (${workspaceId}::uuid, ${contactId}::uuid)
  `;
  const conversations = await db!<Array<{ id: string }>>`
    INSERT INTO conversations (contact_id, channel)
    VALUES (${contactId}::uuid, 'whatsapp') RETURNING id
  `;
  const conversationId = conversations[0].id;
  const sourceOrder = input.sourceOrder ?? 4;
  const messages = await db!<Array<{ id: string }>>`
    INSERT INTO messages (conversation_id, contact_id, direction, content, conversation_seq)
    VALUES (${conversationId}::uuid, ${contactId}::uuid, 'inbound', 'Llamame', ${sourceOrder})
    RETURNING id
  `;
  await db!`
    INSERT INTO offerings (
      workspace_id, code, display_name, offering_type, status, description,
      value_proposition, price_type, price_amount, currency, billing_interval,
      delivery, audience, guardrails, metadata
    ) VALUES (
      ${workspaceId}::uuid, 'reparacion_celulares', 'Reparación de Celulares',
      'course', 'active', 'Descripción canónica.', 'Aprendizaje práctico.',
      'fixed', '360.00', 'USD', 'one_time',
      ${db!.json({ modality: 'online', certification: true, classes: 20, modules: 5, includes: ['Ejercicios'] })},
      ${db!.json({ language: 'Spanish' })}, ${db!.json({})},
      ${db!.json({ academy: 'Academia de Oficios', aliases: ['arreglo de celulares'] })}
    )
  `;
  await db!`
    INSERT INTO conversation_sales_context_states_v1 (
      workspace_id, conversation_id, contact_id, selected_offering_code
    ) VALUES (
      ${workspaceId}::uuid, ${conversationId}::uuid, ${contactId}::uuid,
      'reparacion_celulares'
    )
  `;
  const callId = randomUUID();
  const providerCallId = `retell:${randomUUID()}`;
  const context = {
    call_id: callId,
    nombre_lead: input.name ?? '',
    curso_interes: 'reparacion_celulares',
    pais: '',
    email_lead: input.email ?? '',
    resumen_whatsapp: 'Llamada autorizada.',
    prompt_version: 'agent-b-v1',
  };
  await db!`
    INSERT INTO call_sessions (
      id, source_turn_id, contact_id, conversation_id, provider, provider_call_id,
      request_idempotency_key, status, consent_source_message_id, context_snapshot,
      context_hash, prompt_version
    ) VALUES (
      ${callId}::uuid, ${messages[0].id}::uuid, ${contactId}::uuid,
      ${conversationId}::uuid, 'retell', ${providerCallId}, ${`voice-call:${callId}`},
      'provider_accepted', ${messages[0].id}::uuid, ${db!.json(context)},
      decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1'
    )
  `;
  return {
    workspaceId,
    workspaceSlug,
    contactId,
    conversationId,
    callId,
    providerCallId,
    phone,
    sourceOrder,
    spreadsheetId: `sheet-${randomUUID()}`,
  };
}

function envelope(
  ids: Awaited<ReturnType<typeof fixture>>,
  name: string,
  args: unknown,
) {
  return {
    name,
    call: {
      call_id: ids.providerCallId,
      metadata: {
        internal_call_id: ids.callId,
        contact_id: ids.contactId,
        conversation_id: ids.conversationId,
      },
    },
    args,
  };
}

function request(body: unknown) {
  const rawBody = JSON.stringify(body);
  const signature = createHmac('sha256', apiKey)
    .update(rawBody + String(nowMs), 'utf8')
    .digest('hex');
  return new Request('http://localhost/retell/tools/test', {
    method: 'POST',
    headers: {
      'x-retell-signature': `v=${nowMs},d=${signature}`,
      'x-studyx-tools-secret': toolsSecret,
    },
    body: rawBody,
  });
}

function dependencies(
  ids: Awaited<ReturnType<typeof fixture>>,
  database = db!,
) {
  const calls = new PostgresCallStore(database);
  return {
    apiKey,
    toolsSecret,
    workspaceSlug: ids.workspaceSlug,
    calls,
    business: new PostgresBusinessContextStore(database),
    contacts: new PostgresRetellContactToolStore(database),
    sheets: { spreadsheetId: ids.spreadsheetId, tabName: 'Leads' },
    now: () => new Date(nowMs),
  };
}

async function callTool(
  ids: Awaited<ReturnType<typeof fixture>>,
  name: Parameters<typeof handleRetellToolRequest>[1],
  args: unknown,
  database = db!,
) {
  const response = await handleRetellToolRequest(
    request(envelope(ids, name, args)),
    name,
    dependencies(ids, database),
  );
  return { response, body: await response.json() };
}

function lifecycleAnalysis(
  ids: Awaited<ReturnType<typeof fixture>>,
  result: 'no_interesado' | 'seguimiento_agendado',
) {
  return mapRetellLifecycleEvent({
    event: 'call_analyzed',
    call: {
      call_id: ids.providerCallId,
      metadata: {
        internal_call_id: ids.callId,
        contact_id: ids.contactId,
        conversation_id: ids.conversationId,
      },
      end_timestamp: nowMs,
      call_analysis: {
        call_summary: 'Resumen del webhook.',
        custom_analysis_data: { resultado: result, nivel_interes: 'medio' },
      },
    },
  }, ids.callId);
}

run('Retell P0 tools with PostgreSQL', () => {
  it('authorizes a Xendra-relayed tool by shared secret and correlated provider/lead/conversation', async () => {
    const ids = await fixture({ name: 'Ana López' });
    const body = envelope(ids, 'consultar_curso', { curso: 'reparacion_celulares' });
    body.call.metadata = {
      lead_id: ids.contactId,
      conversation_id: ids.conversationId,
    } as never;
    const response = await handleRetellToolRequest(new Request('http://localhost/retell/tools/consultar-curso', {
      method: 'POST',
      headers: { 'x-studyx-tools-secret': toolsSecret },
      body: JSON.stringify(body),
    }), 'consultar_curso', {
      ...dependencies(ids),
      apiKey: '',
      requireRetellSignature: false,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      curso: { codigo: 'reparacion_celulares' },
    });
  });

  it('does not confirm a declared sale until PostgreSQL has verified payment', async () => {
    const ids = await fixture({ name: 'Ana López' });
    const args = {
      resultado: 'venta_confirmada',
      resumen: 'La persona declaró que completó el pago.',
    };

    const unverified = await callTool(ids, 'registrar_resultado', args);
    expect(unverified.response.status).toBe(200);
    expect(unverified.body).toMatchObject({ ok: false, error: { code: 'PAYMENT_NOT_VERIFIED' } });
    await expect(db!<Array<{ result: string | null }>>`
      SELECT result FROM call_sessions WHERE id = ${ids.callId}::uuid
    `).resolves.toEqual([{ result: null }]);

    const offering = await db!<Array<{ id: string }>>`
      SELECT id FROM offerings
      WHERE workspace_id = ${ids.workspaceId}::uuid AND code = 'reparacion_celulares'
    `;
    await db!`
      INSERT INTO payments (
        workspace_id, contact_id, offering_id, amount, currency, status,
        provider, environment, checkout_mode, idempotency_key, paid_at
      ) VALUES (
        ${ids.workspaceId}::uuid, ${ids.contactId}::uuid, ${offering[0].id}::uuid,
        360, 'USD', 'paid', 'fake', 'test', 'payment',
        ${`retell:payment:${ids.callId}:verified`}, now()
      )
    `;

    const verifiedReplay = await callTool(ids, 'registrar_resultado', args);
    expect(verifiedReplay.body).toEqual({ ok: true, recorded: true });
    await expect(db!<Array<{ result: string | null }>>`
      SELECT result FROM call_sessions WHERE id = ${ids.callId}::uuid
    `).resolves.toEqual([{ result: 'venta_confirmada' }]);
  });

  it('merges the correlated contact and converges one exact six-field outbox row', async () => {
    const ids = await fixture({ name: 'Ana López', email: null, sourceOrder: 4 });
    await db!`
      INSERT INTO offerings (
        workspace_id, code, display_name, offering_type, status, description,
        price_type, price_amount, currency
      ) VALUES (
        ${ids.workspaceId}::uuid, 'curso_posterior', 'Curso Posterior',
        'course', 'active', 'Otro curso.', 'fixed', '360.00', 'USD'
      )
    `;
    await db!`
      UPDATE conversation_sales_context_states_v1
      SET selected_offering_code = 'curso_posterior'
      WHERE workspace_id = ${ids.workspaceId}::uuid
        AND conversation_id = ${ids.conversationId}::uuid
    `;
    const first = await callTool(ids, 'guardar_datos_contacto', {
      nombre: 'María',
      email: 'maria@example.test',
      telefono_alternativo: '+5491199999999',
    });
    expect(first.body).toEqual({ ok: true, saved: true, projected: true });
    const initialProjection = await db!<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${ids.workspaceId}:${ids.contactId}`}
    `;
    const correction = await callTool(ids, 'guardar_datos_contacto', {
      nombre: 'Mariana López',
      email: 'mariana@example.test',
      telefono_alternativo: '+5491199999999',
    });
    const replay = await callTool(ids, 'guardar_datos_contacto', {
      nombre: 'Mariana López',
      email: 'mariana@example.test',
      telefono_alternativo: '+5491199999999',
    });

    expect(correction.body).toEqual({ ok: true, saved: true, projected: true });
    expect(replay.body).toEqual({ ok: true, saved: false, projected: false });
    const unrelatedSamePosition = await enqueueLeadProjection({
      workspaceId: ids.workspaceId,
      contactId: ids.contactId,
      spreadsheetId: ids.spreadsheetId,
      tabName: 'Leads',
      sourceOrder: 9,
      sourceKey: `retell-call:${randomUUID()}`,
      nombre: 'Ataque',
      apellido: 'Tardío',
      email: 'attack@example.test',
      cursoInteres: 'Curso Incorrecto',
      ultimaSenal: 'unrelated_same_position',
      traceId: randomUUID(),
    }, { sql: db! });
    expect(unrelatedSamePosition).toMatchObject({ changed: false });
    await expect(db!<Array<{ phone: string; declared_phone: string; name: string; email: string }>>`
      SELECT phone, declared_phone, name, email FROM contacts WHERE id = ${ids.contactId}::uuid
    `).resolves.toEqual([{
      phone: ids.phone,
      declared_phone: '+5491199999999',
      name: 'Mariana López',
      email: 'mariana@example.test',
    }]);
    await expect(db!<Array<{
      id: string;
      payload: Record<string, string>;
      source_order: string;
      source_key: string;
    }>>`
      SELECT id, payload, source_order, source_key FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${ids.workspaceId}:${ids.contactId}`}
    `).resolves.toEqual([{
      id: initialProjection[0].id,
      source_order: '9',
      source_key: `retell-call:${ids.callId}`,
      payload: {
        nombre: 'Mariana',
        apellido: 'López',
        mail: 'mariana@example.test',
        telefono: '+5491199999999',
        tipo_de_curso: 'Reparación de Celulares',
        plan: '',
      },
    }]);

    const delayedA = await enqueueLeadProjection({
      workspaceId: ids.workspaceId,
      contactId: ids.contactId,
      spreadsheetId: ids.spreadsheetId,
      tabName: 'Leads',
      sourceOrder: 8,
      nombre: 'Ana',
      apellido: 'Viejo',
      email: 'old@example.test',
      cursoInteres: 'Viejo',
      ultimaSenal: 'delayed_agent_a',
      traceId: randomUUID(),
    }, { sql: db! });
    const laterA = await enqueueLeadProjection({
      workspaceId: ids.workspaceId,
      contactId: ids.contactId,
      spreadsheetId: ids.spreadsheetId,
      tabName: 'Leads',
      sourceOrder: 10,
      nombre: 'María',
      apellido: 'Nueva',
      email: 'new@example.test',
      cursoInteres: 'Nuevo',
      ultimaSenal: 'later_agent_a',
      traceId: randomUUID(),
    }, { sql: db! });
    expect(delayedA).toMatchObject({ changed: false });
    expect(laterA).toMatchObject({ changed: true });
  });

  it('keeps incomplete contacts out of the Sheet and rejects cross-contact correlation', async () => {
    const ids = await fixture({ name: null, email: null });
    const incomplete = await callTool(ids, 'guardar_datos_contacto', { email: 'only@example.test' });
    expect(incomplete.body).toEqual({ ok: true, saved: true, projected: false });
    await expect(db!<Array<{ id: string }>>`
      SELECT id FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${ids.workspaceId}:${ids.contactId}`}
    `).resolves.toHaveLength(0);

    const other = await fixture({ name: 'Otra Persona', email: null });
    const forged = envelope(ids, 'guardar_datos_contacto', { email: 'attack@example.test' });
    forged.call.metadata.contact_id = other.contactId;
    const response = await handleRetellToolRequest(
      request(forged),
      'guardar_datos_contacto',
      dependencies(ids),
    );
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: 'CALL_CORRELATION_MISMATCH' },
    });
    await expect(db!<Array<{ email: string | null }>>`
      SELECT email FROM contacts WHERE id = ${other.contactId}::uuid
    `).resolves.toEqual([{ email: null }]);

    const crossWorkspace = await handleRetellToolRequest(
      request(envelope(other, 'consultar_curso', { curso: 'reparacion_celulares' })),
      'consultar_curso',
      dependencies(ids),
    );
    expect(await crossWorkspace.json()).toMatchObject({
      ok: false,
      error: { code: 'CALL_CORRELATION_MISMATCH' },
    });
  });

  it('merges a surname captured by Agent B into the same full-name field Agent A reads', async () => {
    const ids = await fixture({ name: 'Ana', email: 'ana@example.test' });
    const result = await callTool(ids, 'guardar_datos_contacto', { apellido: 'Pérez' });
    expect(result.body).toEqual({ ok: true, saved: true, projected: true });
    await expect(db!<Array<{ name: string; email: string }>>`
      SELECT name, email FROM contacts WHERE id = ${ids.contactId}::uuid
    `).resolves.toEqual([{ name: 'Ana Pérez', email: 'ana@example.test' }]);
  });

  it.each(['dispatching', 'dispatch_ambiguous'] as const)(
    'does not mutate an unbound foreign-workspace %s call before authorization',
    async (status) => {
      const configured = await fixture({ name: 'Local Persona', email: 'local@example.test' });
      const foreign = await fixture({ name: 'Foreign Persona', email: 'foreign@example.test' });
      await db!`
        UPDATE call_sessions
        SET provider_call_id = NULL,
            status = ${status},
            provider_accepted_at = NULL,
            dispatch_lease_owner = 'foreign-owner',
            dispatch_lease_until = '2026-09-09T16:30:00Z'::timestamptz,
            error_code = 'FOREIGN_BEFORE_TOOL'
        WHERE id = ${foreign.callId}::uuid
      `;
      const before = await db!<Array<Record<string, string | null>>>`
        SELECT provider_call_id, status, dispatch_lease_owner,
               dispatch_lease_until::text, error_code,
               provider_accepted_at::text, started_at::text, completed_at::text,
               updated_at::text
        FROM call_sessions WHERE id = ${foreign.callId}::uuid
      `;

      const response = await handleRetellToolRequest(
        request(envelope(foreign, 'consultar_curso', { curso: 'reparacion_celulares' })),
        'consultar_curso',
        dependencies(configured),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: { code: 'CALL_CORRELATION_MISMATCH' },
      });
      await expect(db!<Array<Record<string, string | null>>>`
        SELECT provider_call_id, status, dispatch_lease_owner,
               dispatch_lease_until::text, error_code,
               provider_accepted_at::text, started_at::text, completed_at::text,
               updated_at::text
        FROM call_sessions WHERE id = ${foreign.callId}::uuid
      `).resolves.toEqual(before);
    },
  );

  it('binds a legacy NULL workspace once before tool authorization and rejects rebinding', async () => {
    const configured = await fixture({ name: 'Legacy Persona', email: 'legacy@example.test' });
    const phone = `+54911${randomUUID().replace(/\D/gu, '').padEnd(8, '2').slice(0, 8)}`;
    const contact = await db!<Array<{ id: string }>>`
      INSERT INTO contacts (phone, channel_origin) VALUES (${phone}, 'whatsapp') RETURNING id
    `;
    const conversation = await db!<Array<{ id: string }>>`
      INSERT INTO conversations (contact_id, channel) VALUES (${contact[0].id}::uuid, 'whatsapp') RETURNING id
    `;
    await db!`
      INSERT INTO workspace_contacts (workspace_id, contact_id)
      VALUES (${configured.workspaceId}::uuid, ${contact[0].id}::uuid)
    `;
    const message = await db!<Array<{ id: string }>>`
      INSERT INTO messages (conversation_id, contact_id, direction, content)
      VALUES (${conversation[0].id}::uuid, ${contact[0].id}::uuid, 'inbound', 'Llamame')
      RETURNING id
    `;
    const callId = randomUUID();
    const providerCallId = `retell:legacy:${randomUUID()}`;
    const context = {
      call_id: callId,
      nombre_lead: 'Legacy Persona',
      curso_interes: 'reparacion_celulares',
      pais: '',
      email_lead: 'legacy@example.test',
      resumen_whatsapp: 'Legacy call.',
      prompt_version: 'agent-b-v1',
    };
    // No state exists at INSERT time, so the database trigger must retain NULL.
    await db!`
      INSERT INTO call_sessions (
        id, source_turn_id, contact_id, conversation_id, provider, provider_call_id,
        request_idempotency_key, status, consent_source_message_id, context_snapshot,
        context_hash, prompt_version
      ) VALUES (
        ${callId}::uuid, ${message[0].id}::uuid, ${contact[0].id}::uuid,
        ${conversation[0].id}::uuid, 'retell', ${providerCallId}, ${`voice-call:${callId}`},
        'provider_accepted', ${message[0].id}::uuid, ${db!.json(context)},
        decode(${hashCallContext(context)}, 'hex'), 'agent-b-v1'
      )
    `;
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (workspace_id, conversation_id, contact_id)
      VALUES (${configured.workspaceId}::uuid, ${conversation[0].id}::uuid, ${contact[0].id}::uuid)
    `;

    await expect(new PostgresCallStore(db!).resolveRetellToolCall({
      providerCallId,
      metadata: {
        internalCallId: callId,
        contactId: contact[0].id,
        conversationId: conversation[0].id,
      },
      workspaceSlug: configured.workspaceSlug,
    })).resolves.toEqual({ callId });
    await expect(db!<Array<{ workspace_id: string | null }>>`
      SELECT workspace_id FROM call_sessions WHERE id = ${callId}::uuid
    `).resolves.toEqual([{ workspace_id: configured.workspaceId }]);

    const otherWorkspace = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, metadata)
      VALUES (${`legacy-other-${randomUUID()}`}, 'Other', ${db!.json({})})
      RETURNING id
    `;
    await expect(db!`
      UPDATE call_sessions SET workspace_id = ${otherWorkspace[0].id}::uuid
      WHERE id = ${callId}::uuid
    `).rejects.toThrow(/immutable|check constraint/iu);
  });

  it('derives and validates explicit workspace binding on every new Retell session', async () => {
    const configured = await fixture({ name: 'Bound Persona', email: 'bound@example.test' });
    const foreign = await db!<Array<{ id: string }>>`
      INSERT INTO workspaces (slug, display_name, metadata)
      VALUES (${`binding-foreign-${randomUUID()}`}, 'Foreign', ${db!.json({})})
      RETURNING id
    `;
    const makeSource = async () => {
      const message = await db!<Array<{ id: string }>>`
        INSERT INTO messages (conversation_id, contact_id, direction, content)
        VALUES (${configured.conversationId}::uuid, ${configured.contactId}::uuid, 'inbound', 'Nueva llamada')
        RETURNING id
      `;
      return message[0].id;
    };
    const context = (callId: string) => ({
      call_id: callId,
      nombre_lead: 'Bound Persona',
      curso_interes: 'reparacion_celulares',
      pais: '',
      email_lead: 'bound@example.test',
      resumen_whatsapp: 'Bound call.',
      prompt_version: 'agent-b-v1',
    });
    const insertCall = async (workspaceId: string, explicitCallId = randomUUID()) => {
      const sourceId = await makeSource();
      const snapshot = context(explicitCallId);
      return db!`
        INSERT INTO call_sessions (
          id, source_turn_id, contact_id, conversation_id, workspace_id, provider, provider_call_id,
          request_idempotency_key, status, consent_source_message_id, context_snapshot, context_hash,
          prompt_version
        ) VALUES (
          ${explicitCallId}::uuid, ${sourceId}::uuid, ${configured.contactId}::uuid,
          ${configured.conversationId}::uuid, ${workspaceId}::uuid, 'retell', ${`retell:binding:${explicitCallId}`},
          ${`binding:${explicitCallId}`}, 'completed', ${sourceId}::uuid, ${db!.json(snapshot)},
          decode(${hashCallContext(snapshot)}, 'hex'), 'agent-b-v1'
        )
      `;
    };

    await expect(insertCall(configured.workspaceId)).resolves.toBeDefined();
    await expect(insertCall(foreign[0].id)).rejects.toThrow(/workspace|binding|tenant|candidate|check/iu);

    await db!`
      INSERT INTO workspace_contacts (workspace_id, contact_id)
      VALUES (${foreign[0].id}::uuid, ${configured.contactId}::uuid)
    `;
    await db!`
      INSERT INTO conversation_sales_context_states_v1 (workspace_id, conversation_id, contact_id)
      VALUES (${foreign[0].id}::uuid, ${configured.conversationId}::uuid, ${configured.contactId}::uuid)
    `;
    await expect(insertCall(configured.workspaceId)).rejects.toThrow(/ambiguous|binding|tenant|candidate|workspace/iu);
  });

  it('converges the call snapshot before appendEvent commits', async () => {
    const ids = await fixture({ name: 'Atomic Persona', email: 'atomic@example.test' });
    const event = mapRetellLifecycleEvent({
      event: 'call_ended',
      call: {
        call_id: ids.providerCallId,
        metadata: {
          internal_call_id: ids.callId,
          contact_id: ids.contactId,
          conversation_id: ids.conversationId,
        },
        start_timestamp: nowMs - 5_000,
        end_timestamp: nowMs,
        disconnection_reason: 'user_hangup',
      },
    }, ids.callId);
    await expect(new PostgresCallStore(db!).appendEvent(event)).resolves.toBe('recorded');
    await expect(db!<Array<{ status: string; analysis_status: string }>>`
      SELECT status, analysis_status FROM call_sessions WHERE id = ${ids.callId}::uuid
    `).resolves.toEqual([{ status: 'completed', analysis_status: 'pending' }]);
  });

  it('serializes different-contact first projections so both contact transactions commit', async () => {
    const first = await fixture({ name: 'Ana López', email: 'ana@example.test' });
    const second = await fixture({ name: 'Beto Pérez', email: 'beto@example.test' });
    second.spreadsheetId = first.spreadsheetId;
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const functionName = `test_pause_retell_projection_${suffix}`;
    const triggerName = `test_pause_retell_projection_trigger_${suffix}`;
    await db!.unsafe(`
      CREATE FUNCTION public.${functionName}() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.spreadsheet_id = '${first.spreadsheetId}' THEN
          PERFORM pg_sleep(0.25);
        END IF;
        RETURN NEW;
      END
      $$;
      CREATE TRIGGER ${triggerName}
      BEFORE INSERT ON sheet_projection_rows
      FOR EACH ROW EXECUTE FUNCTION public.${functionName}();
    `);
    const [firstClient, secondClient] = openIndependentLocalTestDatabases(2);

    try {
      const [firstResult, secondResult] = await Promise.all([
        callTool(first, 'guardar_datos_contacto', {
          telefono_alternativo: '+5491188888888',
        }, firstClient),
        callTool(second, 'guardar_datos_contacto', {
          telefono_alternativo: '+5491177777777',
        }, secondClient),
      ]);

      expect(firstResult.body).toEqual({ ok: true, saved: true, projected: true });
      expect(secondResult.body).toEqual({ ok: true, saved: true, projected: true });
      await expect(db!<Array<{ row_number: number }>>`
        SELECT row_number FROM sheet_projection_rows
        WHERE spreadsheet_id = ${first.spreadsheetId} AND tab_name = 'Leads'
        ORDER BY row_number
      `).resolves.toEqual([{ row_number: 2 }, { row_number: 3 }]);
      await expect(db!<Array<{ declared_phone: string | null }>>`
        SELECT declared_phone FROM contacts
        WHERE id IN (${first.contactId}::uuid, ${second.contactId}::uuid)
        ORDER BY declared_phone
      `).resolves.toEqual([
        { declared_phone: '+5491177777777' },
        { declared_phone: '+5491188888888' },
      ]);
    } finally {
      await Promise.all([firstClient.end(), secondClient.end()]);
      await db!.unsafe(`
        DROP TRIGGER IF EXISTS ${triggerName} ON sheet_projection_rows;
        DROP FUNCTION IF EXISTS public.${functionName}();
      `);
    }
  });

  it('merges tool/webhook sources deterministically regardless of arrival order', async () => {
    const toolFirst = await fixture({ name: 'Ana López', email: 'ana@example.test' });
    const tool = await callTool(toolFirst, 'registrar_resultado', {
      resultado: 'no_interesado',
      resumen: 'No avanzó.',
    });
    expect(tool.body).toEqual({ ok: true, recorded: true });
    const storedToolEvent = await db!<Array<{
      event_id: string;
      call_id: string;
      event_type: 'analyzed';
      sequence: number;
      occurred_at: Date;
      provider: 'retell';
      payload: Record<string, unknown>;
    }>>`
      SELECT event_id, call_id, event_type, sequence, occurred_at, provider, payload
      FROM call_events
      WHERE call_id = ${toolFirst.callId}::uuid AND event_id = ${`retell:tool:call_analyzed:${toolFirst.providerCallId}`}
    `;
    expect(await new PostgresCallStore(db!).appendEvent({
      schema_version: 1,
      event_id: storedToolEvent[0].event_id,
      call_id: storedToolEvent[0].call_id,
      event_type: storedToolEvent[0].event_type,
      sequence: storedToolEvent[0].sequence,
      occurred_at: new Date(storedToolEvent[0].occurred_at.getTime() + 60_000).toISOString(),
      provider: storedToolEvent[0].provider,
      payload: storedToolEvent[0].payload as never,
    })).toBe('duplicate');
    await expect(recordCallEvent(
      lifecycleAnalysis(toolFirst, 'seguimiento_agendado'),
      { store: new PostgresCallStore(db!) },
    )).resolves.toMatchObject({ persistence: 'recorded' });

    const webhookFirst = await fixture({ name: 'Beto Pérez', email: 'beto@example.test' });
    await recordCallEvent(
      lifecycleAnalysis(webhookFirst, 'seguimiento_agendado'),
      { store: new PostgresCallStore(db!) },
    );
    const changedTool = await callTool(webhookFirst, 'registrar_resultado', {
      resultado: 'no_interesado',
      resumen: 'Intento tardío distinto.',
    });
    const exactReplay = await callTool(webhookFirst, 'registrar_resultado', {
      resultado: 'no_interesado',
      resumen: 'Intento tardío distinto.',
    });
    expect(changedTool.body).toEqual({ ok: true, recorded: true });
    expect(exactReplay.body).toEqual({ ok: true, recorded: true });

    await expect(db!<Array<{ id: string }>>`
      SELECT id FROM call_events
      WHERE call_id = ${webhookFirst.callId}::uuid AND event_type = 'analyzed'
    `).resolves.toHaveLength(2);
    await expect(db!<Array<{ id: string }>>`
      SELECT id FROM call_events
      WHERE call_id = ${toolFirst.callId}::uuid AND event_type = 'analyzed'
    `).resolves.toHaveLength(2);
    await expect(db!<Array<{ result: string }>>`
      SELECT result FROM call_sessions WHERE id = ${toolFirst.callId}::uuid
    `).resolves.toEqual([{ result: 'no_interesado' }]);
    await expect(db!<Array<{ result: string }>>`
      SELECT result FROM call_sessions WHERE id = ${webhookFirst.callId}::uuid
    `).resolves.toEqual([{ result: 'no_interesado' }]);
  });

  it('does not grant first-writer-wins to an analyzed event with only the canonical prefix', async () => {
    const ids = await fixture({ name: 'Ana López', email: 'ana@example.test' });
    const first = lifecycleAnalysis(ids, 'no_interesado');
    const wrongIdentity = {
      ...first,
      event_id: `retell:call_analyzed:${ids.providerCallId}:wrong-suffix`,
    };
    await recordCallEvent(wrongIdentity, { store: new PostgresCallStore(db!) });

    await expect(recordCallEvent({
      ...wrongIdentity,
      payload: {
        event_type: 'analyzed',
        analysis: {
          result: 'seguimiento_agendado',
          nivel_interes: 'medio',
          objecion: null,
          notas: 'Changed replay must conflict.',
        },
      },
    }, { store: new PostgresCallStore(db!) })).rejects.toThrow('CALL_EVENT_REPLAY_CONFLICT');
  });

  it('persists the complete bounded analysis out of order and converges captured email once', async () => {
    const ids = await fixture({ name: 'Ana López', email: null, sourceOrder: 7 });
    const oldIdentity = await callTool(ids, 'guardar_datos_contacto', {
      email: 'old@example.test',
    });
    expect(oldIdentity.body).toEqual({ ok: true, saved: true, projected: true });

    const metadata = {
      internal_call_id: ids.callId,
      contact_id: ids.contactId,
      conversation_id: ids.conversationId,
    };
    const fullAnalysis = {
      event: 'call_analyzed' as const,
      call: {
        call_id: ids.providerCallId,
        metadata,
        end_timestamp: nowMs,
        transcript: 'discarded',
        recording_url: 'https://example.invalid/discarded',
        call_analysis: {
          call_summary: 'Revisará el enlace de pago.',
          user_sentiment: 'positive' as const,
          custom_analysis_data: {
            resultado: 'link_enviado_sin_pago' as const,
            curso_ofrecido: 'Reparación de Celulares',
            precio_ofrecido: 'USD 360',
            objecion_principal: 'precio' as const,
            nivel_interes: 'alto' as const,
            email_capturado: 'new@example.test',
            link_pago_enviado: true,
            pago_confirmado: false,
            pidio_humano: false,
            pidio_no_contactar: false,
            pregunto_si_es_ia: false,
            compromiso_pendiente: 'Revisar mañana.',
          },
        },
      },
    };
    const analyzed = mapRetellLifecycleEvent(fullAnalysis, ids.callId);
    const ended = mapRetellLifecycleEvent({
      event: 'call_ended',
      call: { call_id: ids.providerCallId, metadata, start_timestamp: nowMs - 10_000, end_timestamp: nowMs, disconnection_reason: 'user_hangup' },
    }, ids.callId);
    const started = mapRetellLifecycleEvent({
      event: 'call_started',
      call: { call_id: ids.providerCallId, metadata, start_timestamp: nowMs - 10_000 },
    }, ids.callId);
    const store = new PostgresCallStore(db!);

    await recordCallEvent(analyzed, { store });
    await recordCallEvent(ended, { store });
    await recordCallEvent(started, { store });
    await expect(recordCallEvent(analyzed, { store })).resolves.toMatchObject({ persistence: 'duplicate' });

    await expect(db!<Array<{ email: string | null }>>`
      SELECT email FROM contacts WHERE id = ${ids.contactId}::uuid
    `).resolves.toEqual([{ email: 'new@example.test' }]);
    await expect(db!<Array<{ payload: Record<string, string> }>>`
      SELECT payload FROM sheet_projection_rows
      WHERE projection_key = ${`lead:${ids.workspaceId}:${ids.contactId}`}
    `).resolves.toEqual([{
      payload: {
        nombre: 'Ana',
        apellido: 'López',
        mail: 'new@example.test',
        telefono: expect.stringMatching(/^\+54911\d{8}$/u),
        tipo_de_curso: 'Reparación de Celulares',
        plan: '',
      },
    }]);
    await expect(db!<Array<{ event_type: string; payload: Record<string, unknown> }>>`
      SELECT event_type, payload FROM call_events
      WHERE call_id = ${ids.callId}::uuid
      ORDER BY sequence
    `).resolves.toHaveLength(3);
    const analysisRows = await db!<Array<{ payload: Record<string, unknown> }>>`
      SELECT payload FROM call_events
      WHERE call_id = ${ids.callId}::uuid AND event_type = 'analyzed'
    `;
    expect(analysisRows).toHaveLength(1);
    expect(JSON.stringify(analysisRows[0].payload)).toContain('new@example.test');
    expect(JSON.stringify(analysisRows[0].payload)).not.toContain('discarded');
  });

  it('keeps both sources: webhook enriches email/DNC without replacing the tool result', async () => {
    const ids = await fixture({ name: 'Ana López', email: 'old@example.test', sourceOrder: 7 });
    expect((await callTool(ids, 'guardar_datos_contacto', { email: 'old@example.test' })).body)
      .toEqual({ ok: true, saved: false, projected: true });
    const tool = await callTool(ids, 'registrar_resultado', {
      resultado: 'seguimiento_agendado',
      call_summary: 'La persona revisará la propuesta.',
      user_sentiment: 'positive',
      curso_ofrecido: 'Reparación de Celulares',
      precio_ofrecido: 'USD 360',
      objecion_principal: 'precio',
      nivel_interes: 'alto',
      email_capturado: 'tool@example.test',
      link_pago_enviado: true,
      pago_confirmado: false,
      pidio_humano: false,
      pidio_no_contactar: false,
      pregunto_si_es_ia: false,
      compromiso_pendiente: 'Revisar mañana.',
    });
    expect(tool.body).toEqual({ ok: true, recorded: true });
    const webhook = mapRetellLifecycleEvent({
      event: 'call_analyzed',
      call: {
        call_id: ids.providerCallId,
        metadata: {
          internal_call_id: ids.callId,
          contact_id: ids.contactId,
          conversation_id: ids.conversationId,
        },
        end_timestamp: nowMs,
        call_analysis: {
          call_summary: 'La persona confirmó que no desea más contactos.',
          user_sentiment: 'neutral',
          custom_analysis_data: {
            resultado: 'no_contactar',
            curso_ofrecido: 'Reparación de Celulares',
            precio_ofrecido: 'USD 360',
            objecion_principal: 'ninguna',
            nivel_interes: 'nulo',
            email_capturado: 'webhook@example.test',
            link_pago_enviado: false,
            pago_confirmado: false,
            pidio_humano: false,
            pidio_no_contactar: true,
            pregunto_si_es_ia: false,
            compromiso_pendiente: 'No contactar.',
          },
        },
      }}, ids.callId);
    await recordCallEvent(webhook, { store: new PostgresCallStore(db!) });

    await expect(db!<Array<{ count: string }>>`
      SELECT count(*)::text AS count FROM call_events
      WHERE call_id = ${ids.callId}::uuid AND event_type = 'analyzed'
    `).resolves.toEqual([{ count: '2' }]);
    await expect(db!<Array<{ email: string | null }>>`
      SELECT email FROM contacts WHERE id = ${ids.contactId}::uuid
    `).resolves.toEqual([{ email: 'webhook@example.test' }]);
    await expect(db!<Array<{ result: string | null }>>`
      SELECT result FROM call_sessions WHERE id = ${ids.callId}::uuid
    `).resolves.toEqual([{ result: 'seguimiento_agendado' }]);
  });

  it('does not let a stale analysis email cross the newer Agent A Sheet fence', async () => {
    const ids = await fixture({ name: 'Ana López', email: 'agent@example.test', sourceOrder: 7 });
    await enqueueLeadProjection({
      workspaceId: ids.workspaceId,
      contactId: ids.contactId,
      spreadsheetId: ids.spreadsheetId,
      tabName: 'Leads',
      sourceOrder: agentALeadProjectionSourceOrder(8),
      sourceKey: 'agent-a:newer-turn',
      nombre: 'Ana',
      apellido: 'López',
      email: 'agent@example.test',
      telefono: ids.phone,
      cursoInteres: 'Reparación de Celulares',
      ultimaSenal: 'agent_a_newer_identity',
      traceId: ids.callId,
    }, { sql: db! });
    const response = await callTool(ids, 'registrar_resultado', {
      resultado: 'seguimiento_agendado',
      call_summary: 'Análisis atrasado.',
      email_capturado: 'stale@example.test',
      curso_ofrecido: 'Reparación de Celulares',
      objecion_principal: 'ninguna',
      nivel_interes: 'medio',
      link_pago_enviado: false,
      pago_confirmado: false,
      pidio_humano: false,
      pidio_no_contactar: false,
      pregunto_si_es_ia: false,
    });
    expect(response.body).toEqual({ ok: true, recorded: true });
    await expect(db!<Array<{ email: string | null }>>`
      SELECT email FROM contacts WHERE id = ${ids.contactId}::uuid
    `).resolves.toEqual([{ email: 'agent@example.test' }]);
    await expect(db!<Array<{ payload: Record<string, string> }>>`
      SELECT payload FROM sheet_projection_rows
      WHERE projection_key = ${leadProjectionKey(ids.workspaceId, ids.contactId)}
    `).resolves.toEqual([{
      payload: {
        nombre: 'Ana',
        apellido: 'López',
        mail: 'agent@example.test',
        telefono: expect.stringMatching(/^\+54911\d{8}$/u),
        tipo_de_curso: 'Reparación de Celulares',
        plan: '',
      },
    }]);
  });
});
