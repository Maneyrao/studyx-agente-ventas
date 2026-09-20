import type { XendraVoiceConfig } from '@/lib/config';
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

type XendraDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
  sandboxLookup: SandboxLookup;
};

function callIdFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const callId = (value as Readonly<Record<string, unknown>>).call_id;
  return typeof callId === 'string' && callId.trim() ? callId.trim() : null;
}

export class XendraVoiceProvider implements VoiceProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly config: XendraVoiceConfig,
    private readonly dependencies: XendraDependencies,
  ) {
    this.fetchImpl = dependencies.fetch ?? globalThis.fetch;
    this.now = dependencies.now ?? (() => new Date());
  }

  async placeCall(input: PlaceVoiceCallInput): Promise<{ providerCallId: string; acceptedAt: string }> {
    const context = parseCallContext(input.context);
    if (context.call_id !== input.callId) {
      throw new ConfirmedVoiceProviderError('CALL_CONTEXT_ID_MISMATCH');
    }

    if (input.contactId !== this.config.telegramCanaryContactId) {
      try {
        await assertRealSideEffectAllowed(this.dependencies.sandboxLookup, {
          contactId: input.contactId,
          effect: 'xendra.create_phone_call',
        });
      } catch (error) {
        if (error instanceof RealSideEffectRejectedError) {
          throw new ConfirmedVoiceProviderError(error.code);
        }
        throw error;
      }
    }

    const body = {
      telefono: input.phoneE164,
      conversation_id: input.conversationId,
      lead_id: input.contactId,
      variables: {
        nombre_lead: context.nombre_lead,
        curso_interes: context.curso_interes,
        pais: context.pais,
        email_lead: context.email_lead,
        nombre_asesor: this.config.advisorName,
        numero_closer: this.config.closerNumber,
        resumen_whatsapp: context.resumen_whatsapp,
      },
    };

    let response: Response;
    try {
      response = await this.request(JSON.stringify(body));
    } catch {
      throw new AmbiguousVoiceProviderError('XENDRA_CREATE_NETWORK_OUTCOME_UNKNOWN');
    }

    if (response.status === 400 || response.status === 401 || response.status === 503) {
      throw new ConfirmedVoiceProviderError(`XENDRA_CREATE_REJECTED_${response.status}`);
    }
    if (response.status !== 200 && response.status !== 409) {
      throw new AmbiguousVoiceProviderError(`XENDRA_CREATE_HTTP_OUTCOME_${response.status}`);
    }

    let providerCallId: string | null;
    try {
      providerCallId = callIdFrom(await response.json());
    } catch {
      providerCallId = null;
    }
    if (!providerCallId) {
      throw new AmbiguousVoiceProviderError('XENDRA_CREATE_RESPONSE_MALFORMED');
    }
    return { providerCallId, acceptedAt: this.now().toISOString() };
  }

  async findCallByInternalId(callId: string): Promise<null> {
    void callId;
    return null;
  }

  async cancelCall(providerCallId: string): Promise<void> {
    void providerCallId;
    throw new ConfirmedVoiceProviderError('XENDRA_CANCEL_UNSUPPORTED');
  }

  private async request(body: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      return await this.fetchImpl(this.config.callUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-studyx-orchestrator-secret': this.config.orchestratorSecret,
        },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}
