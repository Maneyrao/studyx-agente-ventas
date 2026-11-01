import type { GoldenTurnObservationV1 } from './judge';
import type { GoldenTurnV1 } from './scenarios';
import type { NegotiationTurnEvidenceV1 } from './negotiation-invariants';
/** Captured at generation, before current-turn memories/effects are committed. */
export interface GenerationNegotiationFactsV1 {
  readonly currentTurnId?:string;
  readonly priorPriceSourceIds?:readonly string[];
  readonly ladder?:NegotiationTurnEvidenceV1['ladder'];
}
export function negotiationEvidenceV1(turn:GoldenTurnV1,observed:GoldenTurnObservationV1):NegotiationTurnEvidenceV1 {
  return {turnId:turn.id,maxBonusChallenge:turn.negotiationProbe==='fourth_bonus_request',customer:turn.customer,response:observed.response,
    authorizedFacts:observed.authorizedFacts,usedFactIds:observed.usedFactIds,selectedOfferingFacts:observed.selectedOfferingFacts,
    ...observed.negotiationFacts,action:observed.backendAction,proposedAction:observed.proposedAction,
    selectedCourse:observed.state.selectedCourse,promotion:observed.state.promotion,offerings:observed.availableOfferings};
}
/** Conditions apply across delivered history, not to named golden steps or move labels. */
export function negotiationSemanticTurnV1(turn:GoldenTurnV1,final:boolean):GoldenTurnV1 {
  return {...turn, priorPromotion:undefined,expected:{move:[],action:[],state:{}},hard:[],
    authority:[{file:'docs/authority/prompt-agente-a-studyx-v2.md',start:106,end:129,contains:'Bonificación'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:204,end:210,contains:'como escalón 4'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:39,end:40,contains:'agrega'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:59,end:71,contains:'bonificación'}],
    must:[
      'Responder al freno actual con valor personalizado y un cierre útil, conservando el orden comercial de la historia entregada: valor, plan de 12 cuotas de USD 30 (total USD 360 sin cambios), aislamiento del único freno y cierre condicional, llamada cuando corresponde, y sólo después bonificación afín. Un escalón puede haberse cumplido antes; no exigir repetirlo ni asociarlo al nombre del turno.',
      'Si se añade un bonificado autorizado, justificar afinidad con el objetivo, conservar el precio y recapitular curso pago y todos los bonificados entregados; cerrar con naturalidad.',
      ...(final?['La conversación completa debe acreditar valor personalizado, reencuadre con el plan de 12 cuotas de USD 30 manteniendo el total USD 360, aislamiento del precio y cierre condicional, y la llamada cuando corresponde antes de bonificar; no basta con autorizar un efecto si se omitió una etapa comercial.']:[])],
    mustNot:[
      'No ofrecer, insinuar ni condicionar una nueva bonificación sin offer_course_bonus autorizado y materializado; formularla como pregunta o hipótesis no sustituye la acción. No confundir recordar un curso ya entregado con prometer uno nuevo.',
      'No inventar hechos, cambiar el precio, repetir cursos bonificados, prometer un cuarto, insistir con llamada rechazada ni arrastrar un paquete a otro curso pago.',
      'No llamar a la bonificación regalo ni usar expresiones como “te regalo” o “te lo dejo”, ni presentarla como excepción personal; autoridad:129.',
      'No usar la llamada para evitar responder por chat ni repetir sólo el mismo argumento de valor o el mismo plan cuando corresponde avanzar al siguiente escalón; conservar valor, cuotas, aislamiento y cierre condicional en orden según la historia.',
      'No adelantar una bonificación ni saltar a llamada o cuotas antes del freno que corresponde trabajar en la historia; no reabrir una llamada ya rechazada.']};
}
