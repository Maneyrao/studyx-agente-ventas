import type { RetellVoiceConfig } from '@/lib/config';
import {
  RealSideEffectRejectedError,
  assertRealSideEffectAllowed,
  type SandboxLookup,
} from '@/lib/services/sandbox.service';
import { parseCallContext } from '../domain/call-context';
import {
  AmbiguousVoiceProviderError,
  ConfirmedVoiceProviderError,
  type PlaceVoiceCallInput,
  type VoiceProvider,
} from '../ports/voice-provider';

type RetellDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  sandboxLookup: SandboxLookup;
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

export class RetellVoiceProvider implements VoiceProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: RetellVoiceConfig,
    private readonly dependencies: RetellDependencies,
  ) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async placeCall(input: PlaceVoiceCallInput): Promise<{ providerCallId: string; acceptedAt: string }> {
    const context = parseCallContext(input.context);
    if (context.call_id !== input.callId) {
      throw new ConfirmedVoiceProviderError('CALL_CONTEXT_ID_MISMATCH');
    }

    const body = {
      from_number: this.config.fromNumber,
      to_number: input.phoneE164,
      override_agent_id: this.config.agentId,
      override_agent_version: this.config.agentVersion,
      agent_override: {
        agent: {
          response_engine: {
            type: 'retell-llm',
            llm_id: this.config.llmId,
            version: this.config.llmVersion,
          },
        },
      },
      metadata: {
        internal_call_id: input.callId,
        contact_id: input.contactId,
        conversation_id: input.conversationId,
      },
      retell_llm_dynamic_variables: {
        nombre_lead: context.nombre_lead,
        apellido_lead: context.apellido_lead ?? '',
        curso_interes: context.curso_interes,
        pais: context.pais,
        email_lead: context.email_lead,
        resumen_whatsapp: context.resumen_whatsapp,
        campos_faltantes: (context.campos_faltantes ?? []).join(', '),
        nombre_asesor: this.config.advisorName,
      },
    };

    try {
      await assertRealSideEffectAllowed(this.dependencies.sandboxLookup, {
        contactId: input.contactId,
        effect: 'retell.create_phone_call',
      });
    } catch (error) {
      if (error instanceof RealSideEffectRejectedError) {
        throw new ConfirmedVoiceProviderError(error.code);
      }
      throw error;
    }

    let response: Response;
    try {
      response = await this.request('/v2/create-phone-call', JSON.stringify(body));
    } catch {
      throw new AmbiguousVoiceProviderError('RETELL_CREATE_NETWORK_OUTCOME_UNKNOWN');
    }
    if (response.status >= 400 && response.status < 500) {
      throw new ConfirmedVoiceProviderError(`RETELL_CREATE_REJECTED_${response.status}`);
    }
    if (!response.ok) {
      throw new AmbiguousVoiceProviderError(`RETELL_CREATE_HTTP_OUTCOME_${response.status}`);
    }

    const payload = await this.json(response);
    const providerCallId = record(payload)?.call_id;
    if (typeof providerCallId !== 'string' || providerCallId.trim().length === 0) {
      throw new AmbiguousVoiceProviderError('RETELL_CREATE_RESPONSE_MALFORMED');
    }
    return { providerCallId, acceptedAt: this.now().toISOString() };
  }

  async findCallByInternalId(callId: string): Promise<{ providerCallId: string } | null> {
    let response: Response;
    try {
      response = await this.request('/v3/list-calls', JSON.stringify({
        filter_criteria: {
          metadata: [{ key: 'internal_call_id', type: 'string', value: callId }],
        },
        limit: 2,
      }));
    } catch {
      throw new AmbiguousVoiceProviderError('RETELL_LOOKUP_NETWORK_OUTCOME_UNKNOWN');
    }
    if (!response.ok) {
      throw new AmbiguousVoiceProviderError(`RETELL_LOOKUP_HTTP_OUTCOME_${response.status}`);
    }

    const payload = record(await this.json(response));
    if (
      !payload
      || !Array.isArray(payload.items)
      || typeof payload.has_more !== 'boolean'
    ) {
      throw new AmbiguousVoiceProviderError('RETELL_LOOKUP_RESPONSE_MALFORMED');
    }
    const matches = payload.items.flatMap((item) => {
      const call = record(item);
      const metadata = record(call?.metadata);
      return metadata?.internal_call_id === callId
        && typeof call?.call_id === 'string'
        && call.call_id.trim().length > 0
        ? [call.call_id]
        : [];
    });
    if (payload.has_more || matches.length > 1) {
      throw new AmbiguousVoiceProviderError('RETELL_LOOKUP_NOT_UNIQUE');
    }
    if (matches.length === 0) return null;
    return { providerCallId: matches[0] };
  }

  async cancelCall(providerCallId: string): Promise<void> {
    let response: Response;
    try {
      response = await this.request(`/v2/stop-call/${encodeURIComponent(providerCallId)}`);
    } catch {
      throw new AmbiguousVoiceProviderError('RETELL_STOP_NETWORK_OUTCOME_UNKNOWN');
    }
    if (response.status >= 400 && response.status < 500) {
      throw new ConfirmedVoiceProviderError(`RETELL_STOP_REJECTED_${response.status}`);
    }
    if (!response.ok) {
      throw new AmbiguousVoiceProviderError(`RETELL_STOP_HTTP_OUTCOME_${response.status}`);
    }
  }

  private async request(path: string, body?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await this.fetchImpl(`${this.config.apiBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          'content-type': 'application/json',
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private async json(response: Response): Promise<unknown> {
    try {
      return await response.json();
    } catch {
      throw new AmbiguousVoiceProviderError('RETELL_RESPONSE_MALFORMED');
    }
  }
}
