import { TurnRejectionV1Schema as BackendRejectionSchema } from '@/features/conversation/adapters/turn-rejection-schema';
import { TurnRejectionV1Schema as BotpressRejectionSchema } from '../../../botpress-agent/src/schemas/turn-rejection';
import { describe,it,expect } from 'vitest';
import { validateCourseMentionsV1 } from '@/shared/conversation/course-mentions';
const catalog=[{code:'paid',display_name:'Fotografía Profesional'},{code:'short',display_name:'Community Manager'},{code:'long',display_name:'Community Manager Avanzado'}];
const base={messages:['Fotografía Profesional'],catalog,paid_offering_code:'paid',delivered_bonus_offering_codes:[]};
describe('canonical course roles (authority prompt:123,129; bonus spec:59-71)',()=>{
  it('uses a current canonical conversational focus only for paid mentions when durable purchase is absent',()=>{
    expect(validateCourseMentionsV1({...base,paid_offering_code:null,paid_mention_offering_code:'short',
      messages:['Community Manager'],course_mentions:[{offering_code:'short',role:'paid'}]}).violations).toEqual([]);
  });
  it('never lets conversational paid identity replace durable identity, create bonus authority or authorize inactive codes',()=>{
    const contextual={...base,paid_offering_code:null,paid_mention_offering_code:'paid'};
    expect(validateCourseMentionsV1({...base,paid_mention_offering_code:'short',messages:['Community Manager'],
      course_mentions:[{offering_code:'short',role:'paid'}]}).violations).toMatchObject([{subject:'course_mentions:paid_mismatch:short'}]);
    expect(validateCourseMentionsV1({...contextual,messages:['Community Manager'],course_mentions:[{offering_code:'short',role:'bonus'}]}).violations)
      .toMatchObject([{subject:'forbidden_promise'}]);
    expect(validateCourseMentionsV1({...contextual,messages:['Community Manager'],course_mentions:[{offering_code:'short',role:'bonus'}],
      authorized_bonus_action:{paid_offering_code:'paid',bonus_offering_code:'short'}}).violations).toMatchObject([{subject:'forbidden_promise'}]);
    expect(validateCourseMentionsV1({...contextual,catalog:[],course_mentions:[{offering_code:'paid',role:'paid'}]}).violations.length).toBeGreaterThan(0);
  });
  it('allows legacy primary only and never infers a role for another exact named course',()=>{
    expect(validateCourseMentionsV1(base).violations).toEqual([]);
    expect(validateCourseMentionsV1({...base,messages:['Community Manager']})).toMatchObject({violations:[{code:'COURSE_ROLE_UNDECLARED'}]});
    expect(validateCourseMentionsV1({...base,call_offer:'Podemos revisar Community Manager.'}).violations).toMatchObject([{code:'COURSE_ROLE_UNDECLARED'}]);
  });
  it('uses exact case-sensitive names without accent folding or aliases',()=>{
    expect(validateCourseMentionsV1({...base,messages:['community manager y Fotografia Profesional']} ).named_offering_codes).toEqual([]);
  });
  it('uses longest nonoverlapping canonical intervals in every bubble',()=>{
    const result=validateCourseMentionsV1({...base,messages:['Community Manager Avanzado','Community Manager'],
      course_mentions:[{offering_code:'long',role:'alternative'},{offering_code:'short',role:'paid_complement'}]});
    expect(result.named_offering_codes).toEqual(['long','short']);expect(result.violations).toEqual([]);
    expect(validateCourseMentionsV1({...base,messages:['Community Manager Avanzado'],course_mentions:[{offering_code:'long',role:'alternative'}]}).named_offering_codes).toEqual(['long']);
  });
  it('does not guess ambiguous names and rejects duplicate, unknown and wrong paid declarations',()=>{
    expect(validateCourseMentionsV1({...base,catalog:[...catalog,{code:'other',display_name:'Community Manager'}],messages:['Community Manager']}).violations[0]?.code).toBe('COURSE_ROLE_UNDECLARED');
    for(const mentions of [[{offering_code:'short',role:'paid' as const}],
      [{offering_code:'unknown',role:'alternative' as const}],
      [{offering_code:'paid',role:'paid' as const},{offering_code:'paid',role:'paid' as const}]])
      expect(validateCourseMentionsV1({...base,course_mentions:mentions}).violations[0]?.code).toBe('COURSE_ROLE_UNDECLARED');
  });
  it('allows declared alternatives and separately paid complements without executing an effect',()=>{
    for(const role of ['alternative','paid_complement'] as const) expect(validateCourseMentionsV1({...base,messages:['Community Manager'],course_mentions:[{offering_code:'short',role}]}).violations).toEqual([]);
  });
  it('requires the exact paid-course bonus effect or an already delivered current benefit',()=>{
    const input={...base,messages:['Fotografía Profesional y Community Manager'],course_mentions:[{offering_code:'short',role:'bonus' as const}]};
    expect(validateCourseMentionsV1(input).violations).toMatchObject([{code:'FACT_VALUE_MISMATCH',subject:'forbidden_promise'}]);
    expect(validateCourseMentionsV1({...input,authorized_bonus_action:{paid_offering_code:'paid',bonus_offering_code:'short'}}).violations).toEqual([]);
    expect(validateCourseMentionsV1({...input,authorized_bonus_action:{paid_offering_code:'other',bonus_offering_code:'short'}}).violations.length).toBeGreaterThan(0);
    expect(validateCourseMentionsV1({...input,delivered_bonus_offering_codes:['short']}).violations).toEqual([]);
  });
  it('does not let an alternative or paid complement declaration contradict the bonus effect',()=>{
    for(const role of ['alternative','paid_complement'] as const) expect(validateCourseMentionsV1({...base,messages:['Community Manager'],
      course_mentions:[{offering_code:'short',role}],authorized_bonus_action:{paid_offering_code:'paid',bonus_offering_code:'short'}}).violations)
      .toMatchObject([{code:'FACT_VALUE_MISMATCH',subject:'forbidden_promise'}]);
  });
  it('preserves already authoritative paid and delivered bonus identities outside the active catalog',()=>{
    expect(validateCourseMentionsV1({...base,catalog:[],course_mentions:[{offering_code:'paid',role:'paid'}]}).violations).toEqual([]);
    expect(validateCourseMentionsV1({...base,catalog:[],course_mentions:[{offering_code:'short',role:'bonus'}],delivered_bonus_offering_codes:['short']}).violations).toEqual([]);
    for(const role of ['alternative','paid_complement'] as const) expect(validateCourseMentionsV1({...base,catalog:[],
      course_mentions:[{offering_code:'short',role}],delivered_bonus_offering_codes:['short']}).violations).toMatchObject([{code:'COURSE_ROLE_UNDECLARED'}]);
    // Pending/cancelled packages supply no confirmed current delivered members.
    expect(validateCourseMentionsV1({...base,catalog:[],
      course_mentions:[{offering_code:'short',role:'bonus'}],delivered_bonus_offering_codes:[]}).violations.length).toBeGreaterThan(0);
  });
  it('emits only transport-safe subjects for every rejection family, ambiguous identities and long codes',()=>{
    const longCode='x'.repeat(160);
    const inputs=[
      {...base,catalog:[...catalog,{code:longCode,display_name:'Community Manager'}],messages:['Community Manager']},
      {...base,messages:['Community Manager'],course_mentions:[{offering_code:longCode,role:'paid' as const},{offering_code:longCode,role:'alternative' as const}]},
      {...base,course_mentions:[{offering_code:'invalid/code',role:'alternative' as const}]},
      {...base,course_mentions:[{offering_code:'short',role:'not_a_role' as never}]},
      {...base,messages:['Community Manager'],course_mentions:[{offering_code:'short',role:'bonus' as const}],ladder:{eligible:false,
        observed_price_objection_count:2,required_price_objection_count:3 as const,call_invitation_status:'not_offered' as const,
        call_offer_count:0,may_offer_call:true,missing_steps:['recorded_price_objections','call_invitation'] as const}},
    ];
    for(const value of inputs) {
      const rejections=validateCourseMentionsV1(value).violations;
      expect(rejections.length).toBeGreaterThan(0);
      const envelope={schema_version:1,rejection_id:'00000000-0000-4000-8000-000000000001',attempt:1,rejections,
        authorized_alternatives:{fact_ids:[],actions:['none'],missing_information:[]}};
      expect(BackendRejectionSchema.safeParse(envelope).success).toBe(true);
      expect(BotpressRejectionSchema.safeParse(envelope).success).toBe(true);
      expect(rejections.every(reason=>reason.subject.length<=160 && !reason.subject.includes(','))).toBe(true);
    }
  });
  it('returns factual ladder metadata when an effectless bonus skips missing prerequisites',()=>{
    const result=validateCourseMentionsV1({...base,messages:['Community Manager'],course_mentions:[{offering_code:'short',role:'bonus'}],
      ladder:{eligible:false,observed_price_objection_count:2,required_price_objection_count:3,call_invitation_status:'not_offered',call_offer_count:0,may_offer_call:true,missing_steps:['recorded_price_objections','call_invitation']}});
    expect(result.violations.map(v=>v.subject)).toContain('direct_bonus:ladder_step_pending');
    expect(result.violations.map(v=>v.subject)).toContain('bonus_ladder:missing:call_invitation');
  });
});
