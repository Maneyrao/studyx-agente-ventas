import { describe,it,expect } from 'vitest';
import { deriveCourseBonusLadderV1,mayOfferCallV1 } from '@/shared/conversation/bonus-ladder';
const base={observed_price_objection_count:3,call_invitation_status:'not_offered' as const,call_offer_count:0,may_offer_call:true};
describe('factual bonus ladder (authority:106-120)',()=>{
  // Regla A del dueño (2026-11-02) reemplaza la regla 10: 2 objeciones o precio único; sin requisito de llamada.
  it('Rule A: two recorded objections or a confirmed price-only barrier, no call prerequisite',()=>{
    expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:1})).toMatchObject({eligible:false,
      missing_steps:['recorded_price_objections'],required_price_objection_count:2});
    expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:2})).toMatchObject({eligible:true,missing_steps:[]});
    expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:0,price_only_barrier_confirmed:true}).eligible).toBe(true);
    for(const status of ['not_offered','offered','declined'] as const)
      expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:2,call_invitation_status:status}).eligible).toBe(true);
    expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:1.5}).eligible).toBe(false);
  });
  it('keeps the established call authorization expression',()=>{
    const call={may_respond:true,blocked:false,active_call:null,call_preference:'unknown',call_offer_status:'not_offered',stage:'exploring',payment_reported:false,call_offer_count:0};
    expect(mayOfferCallV1(call)).toBe(true);
    for(const patch of [{may_respond:false},{blocked:true},{active_call:{}},{call_preference:'call'},
      {call_offer_status:'accepted'},{stage:'handoff'},{stage:'closed'},{stage:'payment_link_sent'},{payment_reported:true},{call_offer_count:2}])
      expect(mayOfferCallV1({...call,...patch})).toBe(false);
  });
});
