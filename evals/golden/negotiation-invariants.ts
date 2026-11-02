/** Evaluation only. Facts are supplied by recorded/live boundaries, never inferred from sales prose. */
export type InvariantStatusV1 = 'PASS' | 'FAIL' | 'INDETERMINATE' | 'NOT_EXERCISED';
export interface NegotiationTurnEvidenceV1 {
  readonly authorizedFacts?:readonly {readonly id:string;readonly kind:string;readonly value:string}[];
  readonly usedFactIds?:readonly string[];
  readonly selectedOfferingFacts?:readonly {readonly id:string;readonly kind:string;readonly value:string}[];
  readonly maxBonusChallenge?:boolean;
  readonly turnId: string; readonly response: string; readonly customer: string;
  readonly currentTurnId?: string; readonly priorPriceSourceIds?: readonly string[];
  readonly currentPriceObjectionQuoted?:boolean;
  readonly currentPriceObjectionPersisted?:boolean;
  readonly currentPriceOnlyBarrierQuoted?:boolean;
  readonly priceOnlyBarrierConfirmed?:boolean;
  readonly ladder?: {readonly observed_price_objection_count:number;readonly required_price_objection_count:2|3;
    readonly price_only_barrier_confirmed?:boolean;
    readonly call_invitation_status:string;readonly call_offer_count:number;readonly may_offer_call:boolean;
    readonly missing_steps:readonly string[];readonly eligible:boolean} | null;
  readonly action: string | null;
  readonly proposedAction: Record<string,unknown> | null;
  readonly selectedCourse: string | null;
  readonly promotion: {readonly status:string|null;readonly paidCourse:string|null;readonly bonusCourses:readonly string[];readonly bonusCount:number};
  readonly offerings:readonly {readonly code:string;readonly displayName:string}[];
}
export interface InvariantCheckV1 {readonly id:string;readonly status:InvariantStatusV1;readonly authority:string;readonly evidence:readonly string[];readonly failedTurnIds:readonly string[];readonly indeterminateTurnIds:readonly string[]}
export const NEGOTIATION_AUTHORITY_V1 = {
  ladder:'AGENTS.md:45-54 (Regla A, reemplaza regla 10); docs/authority/prompt-agente-a-studyx-v2.md:87,106-129',
  package:'docs/authority/spec-backend-bonificacion.md:39-40,59-71',
  semantics:'docs/authority/prompt-agente-a-studyx-v2.md:106-129',
} as const;
export function aggregateInvariantStatusV1(statuses:readonly InvariantStatusV1[]):InvariantStatusV1 {
  if(statuses.includes('FAIL'))return 'FAIL';
  if(statuses.length===0||statuses.includes('INDETERMINATE'))return 'INDETERMINATE';
  return statuses.includes('NOT_EXERCISED')?'NOT_EXERCISED':'PASS';
}
export function evaluateNegotiationInvariantsV1(caseCode:string, turns:readonly NegotiationTurnEvidenceV1[], semanticStatus:InvariantStatusV1, factStatus:InvariantStatusV1='PASS') {
  const records=new Map<string,{status:InvariantStatusV1;evidence:string[];failedTurnIds:string[];indeterminateTurnIds:string[]}>();
  let activeTurnId:string|undefined;
  const record=(id:string,status:InvariantStatusV1,evidence:string)=>{
    const previous=records.get(id);records.set(id,{status:previous?aggregateInvariantStatusV1([previous.status,status]):status,evidence:[...(previous?.evidence??[]),evidence],failedTurnIds:[...(previous?.failedTurnIds??[]),...(status==='FAIL'&&activeTurnId?[activeTurnId]:[])],indeterminateTurnIds:[...(previous?.indeterminateTurnIds??[]),...(status==='INDETERMINATE'&&activeTurnId?[activeTurnId]:[])]});
  };
  let previous:NegotiationTurnEvidenceV1|undefined;
  let offered=0,maximum=0,cancelExercised=false;
  for(const t of turns){
    activeTurnId=t.turnId;
    record('never_silence',t.response.trim()?'PASS':'FAIL',t.turnId);
    maximum=Math.max(maximum,t.promotion.bonusCount);
    if(t.promotion.bonusCount>3)record('max_three','FAIL',`${t.turnId}:count=${t.promotion.bonusCount}`);
    const samePackage=previous?.promotion.paidCourse===t.promotion.paidCourse;
    const priorMembers=samePackage?previous!.promotion.bonusCourses:[];
    const addedMembers=t.promotion.bonusCourses.filter(c=>!priorMembers.includes(c));
    const removedMembers=priorMembers.filter(c=>!t.promotion.bonusCourses.includes(c));
    record('package_members',t.promotion.bonusCount===t.promotion.bonusCourses.length&&new Set(t.promotion.bonusCourses).size===t.promotion.bonusCount?'PASS':'FAIL',`${t.turnId}:count=${t.promotion.bonusCount};members=${t.promotion.bonusCourses.join(',')}`);
    // Cases06/14 have setup=none: their first observed delta is measured from an empty package.
    const emptyBaselineKnown=caseCode.startsWith('06')||caseCode.startsWith('14');
    if((previous||emptyBaselineKnown)&&(addedMembers.length||removedMembers.length)){
      record('ledger_effect_correlation',t.action==='offer_course_bonus'&&addedMembers.length===1&&removedMembers.length===0?'PASS':'FAIL',`${t.turnId}:added=${addedMembers.join(',')};removed=${removedMembers.join(',')};effect=${t.action}`);
    }
    if(previous&&samePackage&&previous.promotion.status!==t.promotion.status){
      const selectedChanged=previous.selectedCourse!==t.selectedCourse;
      const legalCancel=t.promotion.status==='cancelled'&&selectedChanged&&t.promotion.paidCourse===previous.promotion.paidCourse;
      const legalOffer=t.promotion.status==='offer_available'&&t.action==='offer_course_bonus';
      const legalAccept=['accepted','attached'].includes(t.promotion.status??'')&&['accept_promotion','send_payment_link'].includes(t.action??'');
      record('ledger_status_correlation',legalCancel||legalOffer||legalAccept?'PASS':t.action===null||t.action==='none'?'FAIL':'INDETERMINATE',`${t.turnId}:status=${previous.promotion.status}→${t.promotion.status};effect=${t.action};course_changed=${selectedChanged}`);
    }
    if(t.action==='offer_course_bonus'){
      offered++;
      const l=t.ladder;
      if(l?.required_price_objection_count===2){
        // Owner rule A: the current quoted, committed objection counts. A lexical
        // price hint, eligible=true or an unquoted model memory is never evidence.
        const current=t.currentPriceObjectionQuoted===true&&t.currentPriceObjectionPersisted===true;
        const prior=t.priorPriceSourceIds;
        const confirmed=t.priceOnlyBarrierConfirmed===true||l.price_only_barrier_confirmed===true;
        record('prior_ladder',!Number.isInteger(l.observed_price_objection_count)?'INDETERMINATE'
          :l.observed_price_objection_count+(current?1:0)>=2||confirmed?'PASS':'FAIL',`${t.turnId}:${JSON.stringify(l)};current_quoted_persisted=${current};price_only=${confirmed}`);
        if(!t.currentTurnId||!prior)record('prior_sources','INDETERMINATE',`${t.turnId}:missing source IDs`);
        else if(prior.includes(t.currentTurnId))record('prior_sources','FAIL',`${t.turnId}:current source mislabeled as prior`);
        else record('prior_sources',new Set(prior).size+(current?1:0)>=(confirmed?1:2)?'PASS':'FAIL',`${t.turnId}:prior=${prior.join(',')};current=${current};price_only=${confirmed}`);
        // A prior call is intentionally no longer a bonus precondition (owner A).
        // Call policy and early-offer rule B remain separately measured.
      }else{
      record('prior_ladder',!l||!Number.isInteger(l.observed_price_objection_count)?'INDETERMINATE':l.observed_price_objection_count<3?'FAIL':'PASS',`${t.turnId}:${JSON.stringify(l??null)}`);
      if(t.currentTurnId&&t.priorPriceSourceIds){
        record('prior_sources',t.priorPriceSourceIds.includes(t.currentTurnId)?'FAIL':new Set(t.priorPriceSourceIds).size<3?'INDETERMINATE':'PASS',`${t.turnId}:current=${t.currentTurnId};prior=${t.priorPriceSourceIds.join(',')}`);
      }else record('prior_sources','INDETERMINATE',`${t.turnId}:missing committed source IDs`);
      if(l)record('prior_call',['offered','declined'].includes(l.call_invitation_status)||l.may_offer_call===false||l.call_offer_count>=2?'PASS':l.may_offer_call===undefined||l.call_invitation_status===undefined?'INDETERMINATE':'FAIL',`${t.turnId}:${l.call_invitation_status};may_offer=${l.may_offer_call};count=${l.call_offer_count}`);
      else record('prior_call','INDETERMINATE',t.turnId);
      }
      const old=previous?.promotion.paidCourse===t.promotion.paidCourse?previous.promotion.bonusCourses:[];
      const added=t.promotion.bonusCourses.filter(c=>!old.includes(c));
      record('one_distinct_addition',added.length===1&&new Set(t.promotion.bonusCourses).size===t.promotion.bonusCount&&added[0]===t.proposedAction?.bonus_offering_code&&old.every(c=>t.promotion.bonusCourses.includes(c))?'PASS':'FAIL',`${t.turnId}:new=${added.join(',')};prior=${old.join(',')}`);
      record('active_distinct_course',added.every(code=>code!==t.promotion.paidCourse&&t.offerings.some(o=>o.code===code))?'PASS':'FAIL',`${t.turnId}:new=${added.join(',')};paid=${t.promotion.paidCourse}`);
      record('package_recap',semanticStatus==='PASS'?'PASS':'INDETERMINATE',`${t.turnId}:semantic recap of paid=${t.promotion.paidCourse};members=${t.promotion.bonusCourses.join(',')};canonical display-name literal matching is not a requirement`);
      record('effect_matches_proposal',t.proposedAction?.type==='offer_course_bonus'?'PASS':'FAIL',t.turnId);
    }
    if(previous&&previous.selectedCourse!==t.selectedCourse&&previous.promotion.bonusCount>0&&previous.promotion.status!=='cancelled'){
      cancelExercised=true;
      record('course_change_cancellation',t.promotion.paidCourse===previous.promotion.paidCourse?t.promotion.status==='cancelled'?'PASS':'FAIL':'INDETERMINATE',`${t.turnId}:old=${previous.selectedCourse};new=${t.selectedCourse};status=${t.promotion.status}`);
    }
    previous=t;
  }
  activeTurnId=undefined;
  if(maximum<=3)record('max_three',!caseCode.startsWith('06')||maximum===3?'PASS':'NOT_EXERCISED',`maximum=${maximum}; need actual cap exercise`);
  if(!offered)for(const id of ['prior_ladder','prior_sources','prior_call','one_distinct_addition','active_distinct_course','package_recap','effect_matches_proposal'])record(id,'NOT_EXERCISED','No bonus effect executed.');
  if(caseCode.startsWith('06')){
    record('three_additions_exercised',offered>=3&&maximum===3?'PASS':'NOT_EXERCISED',`Test exposure only, not an obligation to sell three: effects=${offered};max=${maximum}`);
    record('fourth_request_exercised',turns.some((t,i)=>t.maxBonusChallenge&&i>0&&turns[i-1]!.promotion.bonusCount===3)?'PASS':'NOT_EXERCISED','Requires a real intervention after three accumulated bonuses.');
  }
  if(caseCode.startsWith('14')&&!cancelExercised)record('course_change_cancellation','NOT_EXERCISED','No paid-course change with a nonempty cancellable package.');
  record('objective_facts',factStatus,'Original nonpositional hard facts retained.');
  record('commercial_semantics',semanticStatus,'Personalized value, authorized installments, affinity, closure and no unauthorized explicit or implicit bonus. Owner A/B override bonus timing and early call; evidence is semantic, never inferred from text patterns.');
  const authorityFor=(id:string)=>{
    if(id==='never_silence'||id==='effect_matches_proposal')return 'docs/authority/prompt-agente-a-studyx-v2.md:236';
    if(id==='package_recap')return 'docs/authority/prompt-agente-a-studyx-v2.md:124';
    if(id==='active_distinct_course')return 'docs/authority/prompt-agente-a-studyx-v2.md:122; docs/authority/spec-backend-bonificacion.md:61-63';
    if(id==='course_change_cancellation')return 'docs/authority/spec-backend-bonificacion.md:40';
    if(id==='commercial_semantics')return 'docs/authority/prompt-agente-a-studyx-v2.md:106-112,122-124,129; docs/authority/spec-backend-bonificacion.md:69-73';
    if(id.startsWith('prior_'))return NEGOTIATION_AUTHORITY_V1.ladder;
    if(id==='objective_facts')return 'docs/authority/prompt-agente-a-studyx-v2.md:50,87,236';
    return 'docs/authority/prompt-agente-a-studyx-v2.md:121; docs/authority/spec-backend-bonificacion.md:64-66,103';
  };
  const checks:InvariantCheckV1[]=[...records].map(([id,value])=>({id,...value,authority:authorityFor(id)}));
  const status=aggregateInvariantStatusV1(checks.map(c=>c.status));
  return {status,approved:status==='PASS'?true:status==='FAIL'?false:null,checks,ledger:turns,turn_results:turns.map(t=>({turnId:t.turnId,status:checks.some(c=>c.failedTurnIds.includes(t.turnId))?'FAIL' as const:checks.some(c=>c.indeterminateTurnIds.includes(t.turnId))?'INDETERMINATE' as const:'PASS' as const}))};
}
