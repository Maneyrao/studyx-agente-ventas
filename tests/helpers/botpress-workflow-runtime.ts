/**
 * Runtime de prueba para ejecutar `processInboundTurn` de verdad.
 *
 * Es deliberadamente distinto de `botpress-runtime-stub.ts`, que se queda como
 * está: aquel sirve a las unitarias, donde `Action.execute` tiene que fallar
 * si nadie la configuró, y cambiarlo rompería suites ajenas.
 *
 * Acá pasa lo contrario. `Action.execute` invoca el handler REAL de la acción,
 * que a su vez usa `requestStudyxJson` — la misma firma HMAC, los mismos
 * reintentos, los mismos `acceptStatuses` y los mismos esquemas Zod que en
 * producción. El evaluador anterior reimplementaba ese transporte en
 * `localSignedJson`, así que medía su propia copia de la orquestación.
 *
 * Qué se sustituye, y nada más:
 *
 * - `Workflow`/`Action`/`Conversation`, que son envoltorios de la plataforma.
 * - `step`, que en Cloud es durable y acá sólo ejecuta y registra.
 * - `client`, el cliente de entrega: los mensajes se capturan en vez de salir.
 * - `adk.zai`, extracción gestionada que el cerebro autoritativo no usa.
 *
 * Qué NO se sustituye, porque es justamente lo que se quiere comprobar: el
 * parser de la propuesta, el constructor de contexto, los resolvers, los
 * validadores, la política del backend, el guard de egress, el commit y los
 * repositorios. Y el backend y PostgreSQL son locales aislados, reales.
 *
 * Lo que esto NO es: no reproduce el scheduler durable de Botpress Cloud, su
 * integración de Telegram, su cuota ni el bundle desplegado. No es un e2e de
 * Telegram y nombrarlo así sería mentir sobre lo que cubre.
 */
import { z } from 'zod';

export { z };

type RuntimeHandler = {
  bivarianceHack(input: unknown): unknown;
}['bivarianceHack'];

interface ConversationDefinition {
  readonly channel: string;
  readonly handler: RuntimeHandler;
}

interface WorkflowDefinition {
  readonly handler: RuntimeHandler;
}

export class Conversation<TDefinition extends ConversationDefinition = ConversationDefinition> {
  definition: TDefinition;
  constructor(definition: TDefinition & ConversationDefinition) {
    this.definition = definition;
  }
}

export class Workflow<TDefinition extends WorkflowDefinition = WorkflowDefinition> {
  definition: TDefinition;
  constructor(definition: TDefinition & WorkflowDefinition) {
    this.definition = definition;
  }

  async getOrCreate(_input: unknown): Promise<{ id: string }> {
    void _input;
    return { id: 'workflow-under-test' };
  }
}

/**
 * Registro de invocaciones de acción.
 *
 * Sirve para una aserción que el arnés necesita poder hacer: que la ruta
 * plannerless NO pida un plan. Contar `planConversation` es la única forma de
 * demostrarlo sin confiar en que el flag estaba puesto.
 */
export interface ActionInvocationV1 {
  readonly name: string;
  readonly ok: boolean;
}

const actionInvocations: ActionInvocationV1[] = [];

export function recordedActionInvocationsV1(): readonly ActionInvocationV1[] {
  return [...actionInvocations];
}

export function resetRecordedActionInvocationsV1(): void {
  actionInvocations.length = 0;
}

/** Ejecuta el handler real de la acción; no hay doble en el medio. */
export class Action<TDefinition = unknown, TOutput = unknown> {
  definition: TDefinition;
  declare readonly __output?: TOutput;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }

  /**
   * El workflow invoca `accion.execute({ input, client })`, y el handler real
   * recibe ESE mismo objeto. Envolverlo otra vez en `{ input }` hacía que el
   * `parse` de la acción viera `{input: {input, client}}` y fallara con
   * ZodError antes de emitir un solo HTTP — un turno muerto en 1 ms que
   * parecía un problema del backend.
   */
  async execute(args: unknown): Promise<TOutput> {
    const definition = this.definition as {
      name?: string;
      handler: (args: unknown) => Promise<TOutput>;
    };
    const name = definition.name ?? 'unknown';
    try {
      const output = await definition.handler(args);
      actionInvocations.push({ name, ok: true });
      return output;
    } catch (error) {
      actionInvocations.push({ name, ok: false });
      throw error;
    }
  }
}

class Exit<TDefinition = unknown> {
  definition: TDefinition;
  constructor(definition: TDefinition) {
    this.definition = definition;
  }
}

export const Autonomous = { Exit };

export const adk = {
  zai: {
    async extract(_text: string, _schema: unknown): Promise<unknown> {
      void _text;
      void _schema;
      // El cerebro autoritativo nunca debe caer acá. Si cae, es un hallazgo.
      throw new Error('ZAI_EXTRACT_NOT_ALLOWED_IN_WORKFLOW_HARNESS');
    },
  },
};

export const context = {
  get(key: string): string {
    return key === 'botId' ? 'workflow-harness-bot' : '';
  },
};

export const configuration: Record<string, unknown> & {
  emulatorPhoneE164: string;
  apiBaseUrl: string;
  orchestratorKeyId: string;
  requestTimeoutMs: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  automationEnabled: boolean;
  decisionProvider: 'botpress_managed' | 'gemini_direct' | 'groq_direct';
  agentABrainDeepSeekModel: string;
  agentAPlannerlessV2Enabled: boolean;
  agentAAdvisorName: string;
} = {
  emulatorPhoneE164: '+15550000001',
  apiBaseUrl: process.env.STUDYX_EVAL_API_BASE_URL ?? 'http://127.0.0.1:3217',
  // Debe coincidir con la clave que el backend aislado tiene registrada.
  orchestratorKeyId: process.env.ORCHESTRATOR_KEY_ID ?? 'botpress-eval',
  requestTimeoutMs: 8_000,
  retryBaseDelayMs: 250,
  retryMaxDelayMs: 2_000,
  automationEnabled: true,
  decisionProvider: 'botpress_managed',
  geminiDecisionModel: 'unused',
  groqDecisionModel: 'unused',
  agentABrainModel: 'unused',
  agentABrainDeepSeekModel: 'deepseek-v4-flash',
  agentABrainOpenAIModel: 'unused',
  agentABrainOpenAIFallbackModel: 'unused',
  // La ruta bajo prueba. Es la MISMA superficie que produccion lee, así que el
  // arnés no puede medir una ruta y producción correr otra.
  agentAPlannerlessV2Enabled: true,
  agentAAdvisorName: '',
};

/**
 * Secretos del arnés.
 *
 * `DEEPSEEK_API_KEY` se toma del entorno del proceso y nunca de un archivo:
 * en modo determinístico ni siquiera se usa, y en modo conversacional viaja
 * sólo en memoria. Ningún valor se imprime.
 */
export const secrets: Record<string, string> = {
  STUDYX_ORCHESTRATOR_KEY: process.env.ORCHESTRATOR_API_KEY ?? 'eval-orchestrator-key',
  STUDYX_SIGNING_SECRET: process.env.STUDYX_SIGNING_SECRET ?? 'eval-signing-secret',
  CRON_SECRET: process.env.CRON_SECRET ?? 'local-eval-cron',
  ...(process.env.DEEPSEEK_API_KEY ? { DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY } : {}),
};
