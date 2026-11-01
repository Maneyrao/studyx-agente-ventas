import { describe, expect, it } from 'vitest';
import { evaluateNegotiationInvariantsV1, type NegotiationTurnEvidenceV1 } from './negotiation-invariants';
function turn(count=3, codes=['extra']): NegotiationTurnEvidenceV1 {
  return { turnId:'t1', response:'Curso pago + Extra', customer:'precio', currentTurnId:'current',
    priorPriceSourceIds:['p1','p2','p3'], ladder:{observed_price_objection_count:count,required_price_objection_count:3,
      call_invitation_status:'offered',call_offer_count:1,may_offer_call:true,missing_steps:[],eligible:true},
    action:'offer_course_bonus', proposedAction:{type:'offer_course_bonus',bonus_offering_code:codes.at(-1)},
    selectedCourse:'paid', promotion:{status:'offer_available',paidCourse:'paid',bonusCourses:codes,bonusCount:codes.length},
    offerings:[{code:'paid',displayName:'Curso pago'},{code:'extra',displayName:'Extra'},{code:'two',displayName:'Dos'},{code:'three',displayName:'Tres'}] };
}
describe('negotiation invariants (authority:106-129; spec:39-40,59-71)',()=>{
  it('rejects premature effects and same-turn objections without interpreting prose',()=>{
    expect(evaluateNegotiationInvariantsV1('06',[turn(2)],'PASS').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('06',[{...turn(),priorPriceSourceIds:['p1','p2','current']}],'PASS').status).toBe('FAIL');
  });
  it('accepts earlier delivered call proof without requiring a particular turn or move label',()=>{
    const result=evaluateNegotiationInvariantsV1('14',[turn(),{...turn(),turnId:'change',action:null,selectedCourse:'new',promotion:{...turn().promotion,status:'cancelled'}}],'PASS');
    expect(result.status).toBe('PASS');
  });
  it('recomputes eligibility from prior count and call facts rather than trusting a cached boolean',()=>{
    const valid=turn();
    expect(evaluateNegotiationInvariantsV1('14',[{...valid,ladder:{...valid.ladder!,eligible:false,missing_steps:['call_invitation']}},{...valid,action:null,selectedCourse:'new',promotion:{...valid.promotion,status:'cancelled'}}],'PASS').status).toBe('PASS');
    expect(evaluateNegotiationInvariantsV1('14',[{...valid,ladder:{...valid.ladder!,eligible:true,call_invitation_status:'not_offered',call_offer_count:0}}],'PASS').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('14',[{...valid,ladder:undefined}],'PASS').status).toBe('INDETERMINATE');
  });
  it('passes complete three-addition and fourth-request coverage without fixed step labels',()=>{
    const first=turn();const second={...turn(3,['extra','two']),turnId:'second',response:'Curso pago Extra Dos'};
    const third={...turn(3,['extra','two','three']),turnId:'third',response:'Curso pago Extra Dos Tres'};
    const challenge={...third,turnId:'challenge',action:null,proposedAction:{type:'none'},maxBonusChallenge:true};
    expect(evaluateNegotiationInvariantsV1('06',[first,second,third,challenge],'PASS').status).toBe('PASS');
    expect(evaluateNegotiationInvariantsV1('06',[first,second,third],'PASS').status).toBe('NOT_EXERCISED');
  });
  it('rejects multiple additions, a fourth and uncancelled package on paid-course change',()=>{
    expect(evaluateNegotiationInvariantsV1('06',[turn(3,['extra','two'])],'PASS').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('06',[turn(3,['extra','two','three','four'])],'PASS').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('14',[turn(),{...turn(),turnId:'change',action:null,selectedCourse:'new'}],'PASS').status).toBe('FAIL');
  });
  it('does not accept an empty replacement package without evidence of cancellation of the old package',()=>{
    const replacement={...turn(),turnId:'change',action:null,selectedCourse:'new',promotion:{status:null,paidCourse:'new',bonusCourses:[],bonusCount:0}};
    expect(evaluateNegotiationInvariantsV1('14',[turn(),replacement],'PASS').checks.find(c=>c.id==='course_change_cancellation')?.status).toBe('INDETERMINATE');
  });
  it('attributes concrete structural failures only to affected turns',()=>{
    const valid=turn();const premature={...turn(2),turnId:'bad'};
    const result=evaluateNegotiationInvariantsV1('14',[valid,premature],'PASS');
    expect(result.turn_results.find(t=>t.turnId==='bad')?.status).toBe('FAIL');
    expect(result.checks.find(c=>c.id==='prior_ladder')?.failedTurnIds).toEqual(['bad']);
  });
  it('rejects a paid course used as its own bonus',()=>{
    const t={...turn(),proposedAction:{type:'offer_course_bonus',bonus_offering_code:'paid'},promotion:{...turn().promotion,bonusCourses:['paid']}};
    expect(evaluateNegotiationInvariantsV1('14',[t],'PASS').checks.find(c=>c.id==='active_distinct_course')?.status).toBe('FAIL');
  });
  it('requires semantic recap evidence, allowing natural aliases rather than exact display names',()=>{
    expect(evaluateNegotiationInvariantsV1('06',[turn(),{...turn(3,['extra','two']),turnId:'t2',response:'Foto profesional más los dos complementos'}],'INDETERMINATE').checks.find(c=>c.id==='package_recap')?.status).toBe('INDETERMINATE');
    expect(evaluateNegotiationInvariantsV1('06',[turn(),{...turn(3,['extra','two']),turnId:'t2',response:'Foto profesional más los dos complementos'}],'PASS').checks.find(c=>c.id==='package_recap')?.status).toBe('PASS');
  });
  it('rejects a ghost bonus in the first snapshot of known setup-none cases',()=>{
    const ghost={...turn(),action:null,proposedAction:{type:'none'}};
    const legal={...turn(3,['extra','two']),turnId:'legal',response:'Paquete y los dos complementos'};
    const cancel={...legal,turnId:'cancel',action:null,selectedCourse:'new',promotion:{...legal.promotion,status:'cancelled'}};
    const result=evaluateNegotiationInvariantsV1('14',[ghost,legal,cancel],'PASS');
    expect(result.status).toBe('FAIL');
    expect(result.checks.find(c=>c.id==='ledger_effect_correlation')?.failedTurnIds).toContain('t1');
  });
  it('rejects additions or status mutation without a correlated effect on any turn',()=>{
    const first=turn();
    const silentAddition={...turn(3,['extra','two']),turnId:'bad',action:null,proposedAction:{type:'none'},response:'Seguimos por chat'};
    const cancel={...silentAddition,turnId:'change',selectedCourse:'new',promotion:{...silentAddition.promotion,status:'cancelled'}};
    expect(evaluateNegotiationInvariantsV1('14',[first,silentAddition,cancel],'PASS').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('14',[first,{...first,turnId:'bad',action:null,promotion:{...first.promotion,status:'accepted'}}],'PASS').checks.find(c=>c.id==='ledger_status_correlation')?.status).toBe('FAIL');
  });
  it('never passes empty coverage or missing semantic evidence',()=>{
    expect(evaluateNegotiationInvariantsV1('06',[],'PASS').approved).toBe(null);
    expect(evaluateNegotiationInvariantsV1('14',[turn()],'INDETERMINATE').approved).toBe(null);
    expect(evaluateNegotiationInvariantsV1('14',[turn()],'PASS').checks.find(c=>c.id==='course_change_cancellation')?.status).toBe('NOT_EXERCISED');
  });
  it('does not classify generic insinuations by regex; an explicit portable semantic failure fails',()=>{
    const t={...turn(),action:null,proposedAction:{type:'none'},promotion:{status:null,paidCourse:null,bonusCourses:[],bonusCount:0},response:'Si sumo un curso extra, avanzarías?'};
    expect(evaluateNegotiationInvariantsV1('14',[t],'FAIL').status).toBe('FAIL');
    expect(evaluateNegotiationInvariantsV1('14',[t],'INDETERMINATE').approved).toBe(null);
  });
});
