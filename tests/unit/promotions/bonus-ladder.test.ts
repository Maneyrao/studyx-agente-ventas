import { describe,it,expect } from 'vitest';
import { deriveCourseBonusLadderV1,mayOfferCallV1 } from '@/shared/conversation/bonus-ladder';
describe('bonus permission evidence (AGENTS.md "Venta interpretada por el modelo")',()=>{
  it('price evidence alone makes the permission eligible; no objection count, no instant trigger',()=>{
    expect(deriveCourseBonusLadderV1({price_evidence:true,retention_used:false})).toEqual({eligible:true,price_evidence:true,
      retention_decline:false,retention_used:false,missing_steps:[]});
    expect(deriveCourseBonusLadderV1({price_evidence:false,retention_used:false})).toMatchObject({eligible:false,missing_steps:['price_evidence']});
  });
  it('a quoted purchase decline is eligible once per conversation',()=>{
    expect(deriveCourseBonusLadderV1({price_evidence:false,retention_decline:true,retention_used:false}))
      .toMatchObject({eligible:true,retention_decline:true,missing_steps:[]});
    expect(deriveCourseBonusLadderV1({price_evidence:false,retention_decline:true,retention_used:true}))
      .toMatchObject({eligible:false,retention_decline:false,retention_used:true,missing_steps:['price_evidence']});
  });
  it('a used retention does not remove price evidence',()=>{
    expect(deriveCourseBonusLadderV1({price_evidence:true,retention_decline:true,retention_used:true}).eligible).toBe(true);
  });
  it('keeps the established call authorization expression',()=>{
    const call={may_respond:true,blocked:false,active_call:null,call_preference:'unknown',call_offer_status:'not_offered',stage:'exploring',payment_reported:false,call_offer_count:0};
    expect(mayOfferCallV1(call)).toBe(true);
    for(const patch of [{may_respond:false},{blocked:true},{active_call:{}},{call_preference:'call'},
      {call_offer_status:'accepted'},{stage:'handoff'},{stage:'closed'},{stage:'payment_link_sent'},{payment_reported:true},{call_offer_count:2}])
      expect(mayOfferCallV1({...call,...patch})).toBe(false);
  });
});
