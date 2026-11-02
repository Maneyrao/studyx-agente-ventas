import type { GoldenTurnObservationV1 } from './judge';
import type { GoldenTurnV1 } from './scenarios';
import type { NegotiationTurnEvidenceV1 } from './negotiation-invariants';
/** Captured at generation, before current-turn memories/effects are committed. */
export interface GenerationNegotiationFactsV1 {
  readonly currentTurnId?:string;
  readonly priorPriceSourceIds?:readonly string[];
  readonly currentPriceObjectionQuoted?:boolean;
  readonly currentPriceObjectionPersisted?:boolean;
  readonly currentPriceOnlyBarrierQuoted?:boolean;
  readonly priceOnlyBarrierConfirmed?:boolean;
  readonly ladder?:NegotiationTurnEvidenceV1['ladder'];
}
export function negotiationEvidenceV1(turn:GoldenTurnV1,observed:GoldenTurnObservationV1):NegotiationTurnEvidenceV1 {
  return {turnId:turn.id,maxBonusChallenge:turn.negotiationProbe==='fourth_bonus_request',customer:turn.customer,response:observed.response,
    authorizedFacts:observed.authorizedFacts,usedFactIds:observed.usedFactIds,selectedOfferingFacts:observed.selectedOfferingFacts,
    ...observed.negotiationFacts,action:observed.backendAction,proposedAction:observed.proposedAction,
    selectedCourse:observed.state.selectedCourse,promotion:observed.state.promotion,offerings:observed.availableOfferings};
}
/** Conditions apply across delivered history, not to named golden steps or move labels. */
export function negotiationSemanticTurnV1(turn:GoldenTurnV1,final:boolean,ownerRules=false):GoldenTurnV1 {
  if(ownerRules)return {...turn,priorPromotion:undefined,expected:{move:[],action:[],state:{}},hard:[],
    authority:[{file:'AGENTS.md',start:40,end:62,contains:'REGLA A'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:87,end:129,contains:'price_objection'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:135,end:145,contains:'afinidades'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:59,end:73,contains:'bonificación'}],
    must:[
      'Responder al freno actual con valor personalizado y un cierre útil, manteniendo los planes de 12 cuotas de USD 30, 6 de USD 60 o un pago de USD 360 y el total sin cambios. No repetir cuotas como único argumento si el cliente sigue objetando.',
      'Aplicar la excepción expresa del dueño: la segunda objeción registrada, incluida la actual con cita literal, o el precio como único freno confirmado habilita y exige la Regla A, sin esperar una llamada previa ni los antiguos tres turnos de objeción. La Regla B exige invitación temprana autorizada en la segunda o tercera respuesta con interés; puede coincidir con A. Respetar checkout, pago, chat, opt-out, rechazo y límites.',
      'Si se añade un bonificado, explicar su afinidad con el objetivo, conservar el precio y cerrar en ese turno; al escalar, recapitular curso pago y todos los bonificados entregados. El respaldo fijo autorizado por el dueño cumple el formato aun cuando no explique la afinidad en prosa.',
      ...(final?['La historia completa debe acreditar valor personalizado, respuesta al precio y cierre, oferta temprana de llamada cuando esté autorizada y bonificaciones según la Regla A; no exigir que el cliente repita una objeción ni que acepte llamada para recibir una oferta decidida por el backend.']:[])],
    mustNot:[
      'No ofrecer, insinuar ni condicionar una bonificación sin offer_course_bonus autorizado y materializado. No confundir recordar un bonificado entregado con prometer otro.',
      'No inventar hechos, cambiar el precio, duplicar cursos bonificados, prometer un cuarto, insistir con llamada rechazada ni arrastrar un paquete a otro curso pago.',
      'No llamar a la bonificación regalo ni usar “te regalo”, “te lo dejo” o una excepción personal. No usar fórmulas defensivas ni inventar urgencia.',
      'No usar la llamada para evitar responder por chat ni prometer una llamada inmediata sin la acción ejecutada. No suprimir una regla sólo porque la otra también aplica.',
      'No interpretar preguntas de precio ni negaciones como una objeción nueva, ni usar palabras aisladas de una cita para bonificar.']};
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
