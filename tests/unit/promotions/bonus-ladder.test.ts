import { describe,it,expect } from 'vitest';
import { deriveCourseBonusLadderV1,mayOfferCallV1 } from '@/shared/conversation/bonus-ladder';
const base={observed_price_objection_count:3,call_invitation_status:'not_offered' as const,call_offer_count:0,may_offer_call:true};
describe('factual bonus ladder (authority:106-120)',()=>{
  it('requires three recorded interventions plus prior invitation or lack of authorization',()=>{
    expect(deriveCourseBonusLadderV1({...base,observed_price_objection_count:2})).toMatchObject({eligible:false,
      missing_steps:['recorded_price_objections','call_invitation']});
    expect(deriveCourseBonusLadderV1(base)).toMatchObject({eligible:false,missing_steps:['call_invitation']});
    for(const status of ['offered','declined'] as const) expect(deriveCourseBonusLadderV1({...base,call_invitation_status:status}).eligible).toBe(true);
    expect(deriveCourseBonusLadderV1({...base,may_offer_call:false}).eligible).toBe(true);
    expect(deriveCourseBonusLadderV1({...base,call_offer_count:2}).eligible).toBe(true);
  });
  it('keeps the established call authorization expression',()=>{
    const call={may_respond:true,blocked:false,active_call:null,call_preference:'unknown',call_offer_status:'not_offered',stage:'exploring',payment_reported:false,call_offer_count:0};
    expect(mayOfferCallV1(call)).toBe(true);
    for(const patch of [{may_respond:false},{blocked:true},{active_call:{}},{call_preference:'call'},
      {call_offer_status:'accepted'},{stage:'handoff'},{stage:'closed'},{stage:'payment_link_sent'},{payment_reported:true},{call_offer_count:2}])
      expect(mayOfferCallV1({...call,...patch})).toBe(false);
  });
});
