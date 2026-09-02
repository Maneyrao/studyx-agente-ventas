import type { ConversationComposerInputV1 } from '../lib/conversation/conversation-composer'
import {
  STUDYX_SALES_BEHAVIOR_V1,
  STUDYX_SALES_BEHAVIOR_VERSION,
} from './studyx-sales-behavior-v1'

export const CONVERSATION_COMPOSER_PROMPT_VERSION = 'studyx-conversation-composer-v2'

const CONTRACT = `Componé únicamente la narrativa sin valores alrededor de un TurnPlanV1 autorizado.
Devolvé ComposedNarrativeV1. used_fact_ids sólo puede contener IDs presentes en fact_refs. Incluí un ID
cuando el bloque canónico sea necesario, pero nunca infieras su valor desde el identificador.

No escribas ni parafrasees nombres de cursos o áreas, precios, cantidades, duración, modalidad,
certificación, valores de planes, URLs ni promesas comerciales. Esos valores se omiten deliberadamente y
el backend los renderiza. No autorices ni sugieras que una llamada, pago, inscripción o proyección ocurrió.
Seguí response_goal y allowed_business_action únicamente como contexto estructural.

Continuidad. Si viene last_agent_reply, es lo último que dijiste vos. No repitas literal ese texto ni
lo reformules entero: quien vuelve a preguntar algo ya respondido necesita una respuesta más corta y
directa, no la misma otra vez. Retomá lo dicho en una frase y avanzá al paso siguiente. Si el cliente
ya eligió una opción, hablá de ésa y no vuelvas a abrir la lista completa.`

export function buildConversationComposerInstructionsV2(input: ConversationComposerInputV1): string {
  // El turno anterior va en su propia sección y no dentro del JSON: ahí abajo
  // queda al mismo nivel que cualquier otro campo y se lee como dato, no como
  // "esto ya lo dijiste".
  const lastReply = input.last_reply?.trim()
  const continuity = lastReply
    ? `\n\n<last_agent_reply>\n${lastReply}\n</last_agent_reply>`
    : ''
  return `<studyx_sales_behavior version="${STUDYX_SALES_BEHAVIOR_VERSION}">\n${STUDYX_SALES_BEHAVIOR_V1}\n</studyx_sales_behavior>\n\n<composer_contract version="${CONVERSATION_COMPOSER_PROMPT_VERSION}">\n${CONTRACT}\n</composer_contract>${continuity}\n\n<authorized_value_free_context>\n${JSON.stringify(input)}\n</authorized_value_free_context>`
}
