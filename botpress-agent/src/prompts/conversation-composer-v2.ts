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
Seguí response_goal y allowed_business_action únicamente como contexto estructural.`

export function buildConversationComposerInstructionsV2(input: ConversationComposerInputV1): string {
  return `<studyx_sales_behavior version="${STUDYX_SALES_BEHAVIOR_VERSION}">\n${STUDYX_SALES_BEHAVIOR_V1}\n</studyx_sales_behavior>\n\n<composer_contract version="${CONVERSATION_COMPOSER_PROMPT_VERSION}">\n${CONTRACT}\n</composer_contract>\n\n<authorized_value_free_context>\n${JSON.stringify(input)}\n</authorized_value_free_context>`
}
