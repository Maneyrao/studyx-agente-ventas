import { describe,it,expect } from 'vitest';
import { mayOfferCallV1 } from '@/shared/conversation/bonus-ladder';
describe('call authorization projection',()=>{
  it('keeps the established call authorization expression',()=>{
    const call={may_respond:true,blocked:false,active_call:null,call_preference:'unknown',call_offer_status:'not_offered',stage:'exploring',payment_reported:false,call_offer_count:0};
    expect(mayOfferCallV1(call)).toBe(true);
    for(const patch of [{may_respond:false},{blocked:true},{active_call:{}},{call_preference:'call'},
      {call_offer_status:'accepted'},{stage:'handoff'},{stage:'closed'},{stage:'payment_link_sent'},{payment_reported:true},{call_offer_count:2}])
      expect(mayOfferCallV1({...call,...patch})).toBe(false);
  });
});
