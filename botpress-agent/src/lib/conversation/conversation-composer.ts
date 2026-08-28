import {
  ComposedNarrativeV1Schema,
  type CanonicalFactRefV1,
  type ComposedNarrativeV1,
  type TurnPlanV1,
} from '../../schemas/conversation-pipeline'
import { buildConversationComposerInstructionsV2 } from '../../prompts/conversation-composer-v2'

export { buildConversationComposerInstructionsV2 }

export const CONVERSATION_COMPOSER_TIMEOUT_MS = 3_000

export interface ConversationComposerInputV1 {
  readonly plan: TurnPlanV1
  readonly fact_refs: readonly CanonicalFactRefV1[]
  readonly customer_goal: string | null
}

export class ConversationComposerError extends Error {
  constructor(public readonly code: string) {
    super(code)
    this.name = 'ConversationComposerError'
  }
}

const NARRATIVE_GOALS = new Set<TurnPlanV1['response_goal']>([
  'greet_and_discover',
  'guide_area_choice',
  'guide_course_choice',
  'explain_selected_course',
  'continue_course_advice',
  'offer_call_or_chat',
  'acknowledge_chat_preference',
  'acknowledge_call_decline',
  'present_payment_options',
  'confirm_selected_plan',
  'acknowledge_payment_deferral',
  'clarify_current_step',
  'catalog_temporarily_unavailable',
])

export function shouldComposeNarrativeV1(plan: TurnPlanV1): boolean {
  return NARRATIVE_GOALS.has(plan.response_goal)
    && plan.allowed_business_action.type === 'none'
}

function fallbackCopy(goal: TurnPlanV1['response_goal']): ComposedNarrativeV1['narrative'] {
  switch (goal) {
    case 'greet_and_discover':
      return { opening: '¡Hola! Te ayudo a encontrar una opción adecuada.', explanation: null, next_question: '¿Qué te gustaría aprender?' }
    case 'guide_area_choice':
      return { opening: 'Podemos empezar por el área que más te interese.', explanation: null, next_question: '¿Cuál querés explorar?' }
    case 'guide_course_choice':
      return { opening: 'Estas son algunas opciones para avanzar.', explanation: null, next_question: '¿Cuál querés conocer mejor?' }
    case 'explain_selected_course':
      return { opening: 'Te comparto la información disponible.', explanation: null, next_question: '¿Qué aspecto querés conocer mejor?' }
    case 'continue_course_advice':
      return { opening: 'Sigamos por escrito.', explanation: 'Puedo continuar orientándote sobre la opción elegida.', next_question: '¿Qué aspecto querés profundizar?' }
    case 'acknowledge_chat_preference':
      return { opening: 'Perfecto, seguimos por chat.', explanation: 'Puedo acompañarte por este medio.', next_question: '¿Qué querés consultar ahora?' }
    case 'acknowledge_call_decline':
      return { opening: 'Entendido, continuamos por escrito.', explanation: null, next_question: '¿Qué aspecto querés revisar?' }
    case 'confirm_call_request':
      return { opening: 'Entendido, registré tu solicitud de llamada.', explanation: null, next_question: null }
    case 'present_payment_options':
      return { opening: 'Estas son las opciones de pago disponibles.', explanation: null, next_question: '¿Cuál te resulta más conveniente?' }
    case 'confirm_selected_plan':
      return { opening: 'Quedó seleccionado ese plan.', explanation: null, next_question: '¿Querés avanzar ahora?' }
    case 'acknowledge_payment_deferral':
      return { opening: 'De acuerdo, conservamos la elección para más adelante.', explanation: null, next_question: null }
    case 'confirm_payment_link':
      return { opening: 'Perfecto, podés avanzar con el enlace autorizado.', explanation: null, next_question: null }
    case 'acknowledge_purchase_decline':
      return { opening: 'Entendido, no avanzaremos con la compra.', explanation: null, next_question: null }
    case 'catalog_temporarily_unavailable':
      return { opening: 'No puedo consultar el catálogo en este momento.', explanation: 'Podemos retomar tu objetivo sin perder el hilo.', next_question: '¿Qué te gustaría aprender?' }
    default:
      return { opening: 'Quiero asegurarme de entenderte bien.', explanation: null, next_question: '¿Podés indicarme cómo querés continuar?' }
  }
}

export function deterministicNarrativeFallbackV1(
  plan: TurnPlanV1,
  refs: readonly CanonicalFactRefV1[],
): ComposedNarrativeV1 {
  return {
    schema_version: 1,
    narrative: fallbackCopy(plan.response_goal),
    used_fact_ids: refs.map((ref) => ref.id),
  }
}

export async function composeConversationNarrativeV1(
  input: ConversationComposerInputV1,
  deps: {
    readonly generate: (request: { readonly instructions: string; readonly signal: AbortSignal }) => Promise<unknown>
    readonly signal?: AbortSignal
  },
): Promise<ComposedNarrativeV1> {
  const generated = await deps.generate({
    instructions: buildConversationComposerInstructionsV2(input),
    signal: deps.signal ?? new AbortController().signal,
  })
  const wrapped = generated && typeof generated === 'object' && !Array.isArray(generated)
    ? (generated as { composition?: unknown }).composition
    : undefined
  const parsed = ComposedNarrativeV1Schema.safeParse(wrapped ?? generated)
  if (!parsed.success) throw new ConversationComposerError('COMPOSER_SCHEMA_INVALID')
  const allowed = new Set(input.fact_refs.map((ref) => ref.id))
  if (parsed.data.used_fact_ids.some((id) => !allowed.has(id))) {
    throw new ConversationComposerError('COMPOSER_UNKNOWN_FACT_ID')
  }
  return parsed.data
}

export async function composeConversationNarrativeWithFallbackV1(
  input: ConversationComposerInputV1,
  deps: {
    readonly generate: (request: { readonly instructions: string; readonly signal: AbortSignal }) => Promise<unknown>
    readonly signal?: AbortSignal
    readonly timeout_ms?: number
  },
): Promise<ComposedNarrativeV1> {
  const fallback = deterministicNarrativeFallbackV1(input.plan, input.fact_refs)
  if (!shouldComposeNarrativeV1(input.plan)) return fallback
  const controller = new AbortController()
  const parentAbort = () => controller.abort()
  deps.signal?.addEventListener('abort', parentAbort, { once: true })
  if (deps.signal?.aborted) controller.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ConversationComposerError('COMPOSER_TIMEOUT'))
    }, deps.timeout_ms ?? CONVERSATION_COMPOSER_TIMEOUT_MS)
  })
  try {
    return await Promise.race([
      composeConversationNarrativeV1(input, { generate: deps.generate, signal: controller.signal }),
      timeout,
    ])
  } catch {
    return fallback
  } finally {
    if (timer) clearTimeout(timer)
    deps.signal?.removeEventListener('abort', parentAbort)
  }
}
