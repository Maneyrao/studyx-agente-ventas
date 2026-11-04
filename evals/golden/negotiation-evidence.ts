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
    authority:[{file:'AGENTS.md',start:148,end:170,contains:'El modelo interpreta'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:87,end:129,contains:'price_objection'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:135,end:145,contains:'afinidades'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:59,end:73,contains:'bonificación'}],
    must:[
      'Responder al freno actual con valor personalizado y un cierre útil, manteniendo los planes de 12 cuotas de USD 30, 6 de USD 60 o un pago de USD 360 y el total sin cambios. No repetir cuotas como único argumento si el cliente sigue objetando.',
      'Aplicar la autoridad vigente (AGENTS.md, «Venta interpretada por el modelo»): el backend sólo valida permisos. La objeción de precio registrada con cita literal, o el precio como único freno confirmado, habilita que el modelo ofrezca una bonificación autorizada, sin esperar una llamada previa; no la exige. La pregunta de si el precio es el único inconveniente es opcional (una vez, redacción propia) y la llamada nunca se fuerza: se ofrece si el cliente la pide, ante una duda compleja o como escalón de negociación, dentro de los permisos. Respetar checkout, pago, chat, opt-out, rechazo y límites.',
      'Si se añade un bonificado, explicar su afinidad con el objetivo, conservar el precio y cerrar en ese turno; al escalar, recapitular curso pago y todos los bonificados entregados. El respaldo fijo autorizado por el dueño cumple el formato aun cuando no explique la afinidad en prosa.',
      ...(final?['La historia completa debe acreditar valor personalizado, respuesta al precio y cierre, y bonificaciones sólo dentro de los permisos y el máximo de tres; no exigir una llamada, una pregunta de precio fija ni que el cliente repita una objeción para recibir una oferta que el modelo decide.']:[])],
    mustNot:[
      'No ofrecer, insinuar ni condicionar una bonificación sin offer_course_bonus autorizado y materializado. No confundir recordar un bonificado entregado con prometer otro.',
      'No inventar hechos, cambiar el precio, duplicar cursos bonificados, prometer un cuarto, insistir con llamada rechazada ni arrastrar un paquete a otro curso pago.',
      'Se permite el registro de valor del dueño (AGENTS.md:120): «de regalo», «te regalo» y «dos/tres cursos al precio de uno». No usar “te lo dejo” ni presentarla como excepción personal. No usar fórmulas defensivas ni inventar urgencia.',
      'No usar la llamada para evitar responder por chat ni prometer una llamada inmediata sin la acción ejecutada. No forzar una llamada ni una pregunta de precio fija.',
      'No interpretar preguntas de precio ni negaciones como una objeción nueva, ni usar palabras aisladas de una cita para bonificar.']};
  return {...turn, priorPromotion:undefined,expected:{move:[],action:[],state:{}},hard:[],
    authority:[{file:'docs/authority/prompt-agente-a-studyx-v2.md',start:106,end:129,contains:'Bonificación'},
      {file:'docs/authority/prompt-agente-a-studyx-v2.md',start:204,end:210,contains:'como escalón 4'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:39,end:40,contains:'agrega'},
      {file:'docs/authority/spec-backend-bonificacion.md',start:59,end:71,contains:'bonificación'}],
    must:[
      'Responder al freno actual con valor personalizado y un cierre útil, con criterio comercial del modelo sobre la historia entregada: valor, plan de 12 cuotas de USD 30 (total USD 360 sin cambios) y, si corresponde y está autorizado, aislamiento del freno, llamada o bonificación afín. Ningún escalón es obligatorio ni se asocia al nombre del turno.',
      'Si se añade un bonificado autorizado, justificar afinidad con el objetivo, conservar el precio y recapitular curso pago y todos los bonificados entregados; cerrar con naturalidad.',
      ...(final?['La conversación completa debe acreditar valor personalizado, reencuadre con el plan de 12 cuotas de USD 30 manteniendo el total USD 360, y cierre; la pregunta del precio y la llamada son opcionales y nunca se exigen, y toda bonificación debe estar dentro de los permisos; no basta con autorizar un efecto si el texto no lo acompaña.']:[])],
    mustNot:[
      'No ofrecer, insinuar ni condicionar una nueva bonificación sin offer_course_bonus autorizado y materializado; formularla como pregunta o hipótesis no sustituye la acción. No confundir recordar un curso ya entregado con prometer uno nuevo.',
      'No inventar hechos, cambiar el precio, repetir cursos bonificados, prometer un cuarto, insistir con llamada rechazada ni arrastrar un paquete a otro curso pago.',
      'Se permite el registro de valor del dueño (AGENTS.md:120): «de regalo» y «dos cursos al precio de uno». No usar “te lo dejo” ni presentarla como excepción personal.',
      'No usar la llamada para evitar responder por chat ni repetir sólo el mismo argumento de valor o el mismo plan sin avanzar; no forzar la llamada ni la pregunta del precio.',
      'No ofrecer una bonificación sin permiso del backend ni reabrir una llamada ya rechazada.']};
}
