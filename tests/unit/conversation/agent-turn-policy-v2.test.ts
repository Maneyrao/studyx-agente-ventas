import { describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import type { CanonicalFactV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import marketingBudget from '../fixtures/marketing-budget-natural-59cab80.json';
import { contactProfileRequestsForPartsV1 } from '@/features/orchestration/domain/physical-outbound-texts';

const identity = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  contact_id: '33333333-3333-4333-8333-333333333333',
};

const offerings = [
  { code: 'redes_informaticas', display_name: 'Redes Informáticas', aliases: ['redes'] },
  { code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
  { code: 'marketing_digital', display_name: 'Marketing Digital', aliases: [] },
  { code: 'community_manager', display_name: 'Community Manager', aliases: [] },
];

const facts: CanonicalFactV1[] = [
  {
    id: 'offering:redes_informaticas:name:v1', kind: 'offering_name', source: 'business_snapshot',
    value: 'Redes Informáticas', offering_code: 'redes_informaticas',
  },
  {
    id: 'offering:redes_informaticas:duration:v1', kind: 'offering_duration', source: 'business_snapshot',
    value: '16 clases', offering_code: 'redes_informaticas',
  },
  {
    id: 'offering:excel_integral:duration:v1', kind: 'offering_duration', source: 'business_snapshot',
    value: '12 clases', offering_code: 'excel_integral',
  },
  {
    id: 'payment:redes_informaticas:monthly_6:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '6 pagos mensuales de USD 60',
    offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
  },
  {
    id: 'payment:redes_informaticas:monthly_12:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '12 pagos mensuales de USD 30',
    offering_code: 'redes_informaticas', payment_plan: 'monthly_12',
  },
  {
    id: 'payment:redes_informaticas:one_time:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '1 pago de USD 360',
    offering_code: 'redes_informaticas', payment_plan: 'one_time',
  },
  {
    id: 'payment:excel_integral:one_time:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '1 pago de USD 360',
    offering_code: 'excel_integral', payment_plan: 'one_time',
  },
];

function state(overrides: Partial<ConversationStateV1> = {}): ConversationStateV1 {
  return { ...createDefaultConversationStateV1(identity), ...overrides };
}

const PRICE_MOVE = { schema_version: 1 as const, move: 'price_objection' as const, secondary_moves: [] as never[], vetoes: [] as never[], confidence: 0.95 };

function proposal(overrides: Partial<AgentATurnProposalV1> = {}): AgentATurnProposalV1 {
  return {
    schema_version: 1,
    move: {
      schema_version: 1,
      move: 'unknown',
      secondary_moves: [],
      vetoes: [],
      confidence: 0.95,
    },
    response: { messages: ['Contame qué querés aprender y te oriento.'] },
    proposed_action: { type: 'none' },
    used_fact_ids: [],
    used_memory_ids: [],
    memory_candidates: [],
    repair_of: null,
    ...overrides,
  };
}

const completeIntake = {
  nombre: 'Matía', apellido: 'Damonte', correo: 'matia@example.com', telefono: '+5491112345678',
};

describe('exact call transport deduplication authorized on 2026-11-01', () => {
  const invitation='Si querés, podemos verlo en una llamada corta. Te sirve?';
  it.each([[invitation], [invitation, 'El curso tiene 16 clases.'], ['El curso tiene 16 clases.', invitation]])(
    'delivers the dedicated invitation once, without changing the raw proposal: %j', (...messages: string[]) => {
      const raw=proposal({response:{messages,call_offer:invitation}});
      const before=structuredClone(raw);
      const result=authorize({proposal:raw,customerText:'El precio es lo único que me frena.'});
      expect(result).toMatchObject({ok:true,action:{type:'none'},
        transition:{call_offer_count:1,call_offer_status:'offered'}});
      if(!result.ok) throw Error('Expected authorized call invitation');
      expect(result.response_messages).toEqual(messages.length===1
        ? [invitation] : ['El curso tiene 16 clases.',invitation]);
      expect(raw).toEqual(before);
    },
  );
  it('preserves a nonidentical invitation instead of trimming or matching its meaning',()=>{
    const variant=`Primero vemos el objetivo. ${invitation}`;
    const result=authorize({proposal:proposal({response:{messages:[variant],call_offer:invitation}})});
    if(!result.ok) throw Error('Expected unchanged authored response');
    expect(result.response_messages).toEqual([variant,invitation]);
  });
  it('keeps profile metadata on a raw second bubble shifted by the removed first copy',()=>{
    const raw=proposal({response:{messages:[invitation,'Cómo te llamás?'],call_offer:invitation},
      profile_requests:[{message_index:1,fields:['nombre'],purpose:'identity',mode:'collect'}]});
    const result=authorize({proposal:raw});
    if(!result.ok) throw Error('Expected authorized call invitation');
    expect(result.response_messages).toEqual(['Cómo te llamás?',invitation]);
    expect(contactProfileRequestsForPartsV1({authored_messages:raw.response.messages,
      part_texts:result.response_messages,requests:raw.profile_requests!}))
      .toEqual([[{fields:['nombre'],purpose:'identity',mode:'collect'}],[]]);
  });
  it('attaches metadata once when the dedicated invitation is the entire visible reply',()=>{
    const asksPhone='Para llamarte y verlo juntos, me confirmás tu teléfono?';
    const raw=proposal({response:{messages:[asksPhone],call_offer:asksPhone},
      profile_requests:[{message_index:0,fields:['telefono'],purpose:'call',mode:'collect'}]});
    const result=authorize({proposal:raw});
    if(!result.ok) throw Error('Expected authorized call invitation');
    expect(result.response_messages).toEqual([asksPhone]);
    expect(contactProfileRequestsForPartsV1({authored_messages:raw.response.messages,
      part_texts:result.response_messages,requests:raw.profile_requests!}))
      .toEqual([[{fields:['telefono'],purpose:'call',mode:'collect'}]]);
  });
});

function authorize(input: {
  proposal: AgentATurnProposalV1;
  state?: ConversationStateV1;
  intake?: typeof completeIntake;
  mayOfferCall?: boolean;
  mayRequestCall?: boolean;
  customerText?: string;
  semanticRejections?: 'blocking' | 'advisory';
  actionRejections?: 'blocking' | 'structured';
  paymentVerified?: boolean;
  courseBonus?: Parameters<typeof authorizeAgentTurnV2>[0]['course_bonus'];
  paidMention?: string | null;
}) {
  return authorizeAgentTurnV2({
    proposal: input.proposal,
    state: input.state ?? state(),
    offerings,
    facts,
    contact_intake: input.intake,
    current_customer_messages: input.customerText ? [input.customerText] : [],
    semantic_rejections: input.semanticRejections,
    action_rejections: input.actionRejections,
    payment_verified: input.paymentVerified,
    course_bonus: input.courseBonus,
    paid_mention_offering_code:input.paidMention,
    call_policy: {
      may_offer_call: input.mayOfferCall ?? true,
      may_request_call_now: input.mayRequestCall ?? true,
    },
  });
}

describe('plannerless Agent A authority', () => {
  it('uses conversational paid identity for prose only, keeping purchase state and effects unchanged',()=>{
    const result=authorize({state:state({selected_offering_code:null}),paidMention:'redes_informaticas',
      proposal:proposal({response:{messages:['Redes Informáticas puede servirte.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'}]})});
    expect(result).toMatchObject({ok:true,action:{type:'none'},transition:{selected_offering_code:null,selected_payment_plan:null}});
  });
  it('treats a paid declaration for a recommended course as metadata when nothing is persisted (real draft natural-59cab80 17/marketing_budget)',()=>{
    const draft=marketingBudget.drafts[0]!;
    const raw=proposal({response:{messages:draft.messages as [string,...string[]]},course_mentions:draft.course_mentions as never});
    // Focus-only or no focus: the recommendation is not rejected and prose is untouched.
    for(const paidMention of [null,'redes_informaticas'] as const){
      const result=authorize({state:state({selected_offering_code:null}),paidMention,proposal:raw});
      expect(result).toMatchObject({ok:true,action:{type:'none'},transition:{selected_offering_code:null,selected_payment_plan:null}});
      if(result.ok) expect(result.response_messages).toEqual(draft.messages);
    }
    // A durable selection keeps rejecting the mismatch.
    expect(authorize({state:state({selected_offering_code:'excel_integral'}),paidMention:null,proposal:raw}))
      .toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED'],rejection_subjects:['course_mentions:paid_mismatch:marketing_digital']});
  });
  it('does not let conversational focus replace a fresher durable paid selection',()=>{
    const result=authorize({state:state({selected_offering_code:'excel_integral'}),paidMention:'redes_informaticas',
      proposal:proposal({response:{messages:['Redes Informáticas puede servirte.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'}]})});
    expect(result).toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED'],rejection_subjects:['course_mentions:paid_mismatch:redes_informaticas']});
  });
  it.each(['offered','cancelled'] as const)('never turns contextual paid identity into bonus/package authority: %s',packageStatus=>{
    const result=authorize({state:state({selected_offering_code:null}),paidMention:'redes_informaticas',
      courseBonus:{status:'offer_available',package_status:packageStatus,interest_offering_code:'redes_informaticas',
        may_request_review:false,may_schedule_checkin:false,may_accept_offer:false,may_send_promoted_payment:false,
        promotion_code:null,bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],delivered_bonus_offerings:[]},
      proposal:proposal({response:{messages:['Redes Informáticas incluye Excel Integral.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}]})});
    expect(result).toMatchObject({ok:false,reasons:['COMMERCIAL_TRUTH_VIOLATION'],rejection_subjects:['forbidden_promise']});
  });
  it('gives a validated course change precedence over the earlier conversational focus',()=>{
    const result=authorize({state:state({selected_offering_code:'redes_informaticas'}),paidMention:'redes_informaticas',
      proposal:proposal({move:{schema_version:1,move:'select_course',course_reference:'excel_integral',secondary_moves:[],vetoes:[],confidence:1},
        response:{messages:['Excel Integral puede servirte.']},course_mentions:[{offering_code:'excel_integral',role:'paid'}]})});
    expect(result).toMatchObject({ok:true,transition:{selected_offering_code:'excel_integral'}});
  });
  it('accepts the former paid course as an alternative on switch without transferring its bonus package',()=>{
    const packageBeforeSwitch = {
      enabled: true,
      status: 'offer_available' as const,
      package_status: 'offered' as const,
      max_bonus_courses: 3 as const,
      may_offer_bonus: false,
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: 'redes_con_excel',
      interest_offering_code: 'redes_informaticas',
      bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      delivered_bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      bonus_candidates: [],
    };
    const switching = proposal({
      move:{schema_version:1,move:'select_course',course_reference:'marketing_digital',secondary_moves:[],vetoes:[],confidence:1},
      response:{messages:['Dejamos Redes Informáticas de lado y vamos con Marketing Digital.']},
      course_mentions:[
        {offering_code:'marketing_digital',role:'paid'},
        {offering_code:'redes_informaticas',role:'alternative'},
      ],
    });
    expect(authorize({
      state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:packageBeforeSwitch,
      proposal:switching,
    })).toMatchObject({
      ok:true,
      action:{type:'none'},
      transition:{selected_offering_code:'marketing_digital'},
    });

    expect(authorize({
      state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:packageBeforeSwitch,
      proposal:{
        ...switching,
        response:{messages:['Dejamos Redes Informáticas de lado, vamos con Marketing Digital y Excel Integral sigue bonificado.']},
        course_mentions:[...(switching.course_mentions ?? []),{offering_code:'excel_integral',role:'bonus'}],
      },
    })).toMatchObject({
      ok:false,
      reasons:['COMMERCIAL_TRUTH_VIOLATION'],
      rejection_subjects:['forbidden_promise'],
    });
  });
  it("«sí, ese curso» after the agent named a single close course: the model's reference by display name becomes the focus (golden 25 machinery)", () => {
    // Fixed proposal as INPUT to the deterministic resolver; whether the real model produces it is a golden question.
    const select = (reference: string) => authorize({ state: state({ selected_offering_code: null, stage: 'exploring' }),
      proposal: proposal({ move: { schema_version: 1, move: 'select_course', course_reference: reference, secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Excel Integral es el que más se acerca. Te cuento qué vas a ver?'] } }) });
    expect(select('Excel Integral')).toMatchObject({ ok: true, transition: { selected_offering_code: 'excel_integral' } });
    expect(select('Real Estate')).toMatchObject({ ok: false });
  });
  it.each(['payment_plan', 'payment_confirmation', 'contact_details'] as const)(
    // Owner 2026-11-05: a price complaint during checkout may open the bonus until the link is sent; call invitations stay blocked.
    'allows a motivated bonus but rejects a proactive invitation during checkout before the link: %s', awaiting => {
      const cap = { enabled: true, max_bonus_courses: 3 as const, may_offer_bonus: true, status: 'checkin_available' as const,
        may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
        promotion_code: null, interest_offering_code: 'redes_informaticas', bonus_offerings: [],
        bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }],
        ladder: { retention_used: false, previous_turn_asked_price_question: false } };
      const current = state({ selected_offering_code: 'redes_informaticas', awaiting_reply: awaiting });
      const bonusResult = authorize({ state: current, courseBonus: cap, proposal: proposal({
        proposed_action: { type: 'offer_course_bonus', motive:{kind:'price_objection',quote:'me parece muy caro'}, interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' },
        response: { messages: ['Te sumo Excel Integral.'] }, course_mentions: [{ offering_code: 'excel_integral', role: 'bonus' }] }) });
      expect(bonusResult).not.toMatchObject({ rejection_subjects: expect.arrayContaining(['direct_bonus:sale_already_closed']) });
      const sent = authorize({ state: state({ selected_offering_code: 'redes_informaticas', stage: 'payment_link_sent', awaiting_reply: awaiting }),
        courseBonus: cap, proposal: proposal({
          proposed_action: { type: 'offer_course_bonus', motive:{kind:'price_objection',quote:'me parece muy caro'}, interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' },
          response: { messages: ['Te sumo Excel Integral.'] }, course_mentions: [{ offering_code: 'excel_integral', role: 'bonus' }] }) });
      expect(sent).toMatchObject({ ok: false, rejection_subjects: expect.arrayContaining(['direct_bonus:sale_already_closed']) });
      const callResult = authorize({ state: current, mayOfferCall: true, proposal: proposal({
        response: { messages: ['Te cuento las opciones.'], call_offer: 'Si querés, podemos verlo en una llamada corta. Te sirve?' } }) });
      expect(callResult).toMatchObject({ ok: false, reasons: expect.arrayContaining(['CALL_OFFER_NOT_AUTHORIZED']) });
    });

  it('uses the paid identity of a validated bonus effect without inventing a purchase selection',()=>{
    const result=authorize({state:state(),customerText:'me parece muy caro',courseBonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:true,status:'checkin_available',
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:null,
      interest_offering_code:'redes_informaticas',bonus_offerings:[],bonus_candidates:[{code:'excel_integral',display_name:'Excel Integral'}],ladder:{retention_used:false,previous_turn_asked_price_question:false}},
      proposal:proposal({move:PRICE_MOVE,response:{messages:['Redes Informáticas e Excel Integral pueden servirte.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}],
        proposed_action:{type:'offer_course_bonus',motive:{kind:'price_objection',quote:'me parece muy caro'}, interest_offering_code:'redes_informaticas',bonus_offering_code:'excel_integral'}})});
    expect(result).toMatchObject({ok:true,action:{type:'offer_course_bonus'},transition:{selected_offering_code:null}});
  });
  it.each(['offered','cancelled','expired'] as const)('uses only a delivered current package identity for a selectionless recap (%s)',status=>{
    const result=authorize({state:state(),courseBonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:false,status:'offer_available',package_status:status,
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:'p',
      interest_offering_code:'redes_informaticas',bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],
      delivered_bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]},
      proposal:proposal({move:PRICE_MOVE,response:{messages:['Redes Informáticas e Excel Integral pueden servirte.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}]})});
    expect(result.ok).toBe(status==='offered');
  });
  it('does not override primary A with a delivered package for old primary B',()=>{
    const result=authorize({state:state({selected_offering_code:'redes_informaticas'}),courseBonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:false,status:'offer_available',package_status:'offered',
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:'p',interest_offering_code:'excel_integral',
      bonus_offerings:[{code:'redes_informaticas',display_name:'Redes Informáticas',position:1}],delivered_bonus_offerings:[{code:'redes_informaticas',display_name:'Redes Informáticas',position:1}]},
      proposal:proposal({response:{messages:['Excel Integral puede servirte.']},course_mentions:[{offering_code:'excel_integral',role:'paid'}]})});
    expect(result).toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED']});
  });
  it.each(['durable','delivered_identity'] as const)('preserves an inactive authoritative paid identity during a delivered recap (%s)',source=>{
    const cap:NonNullable<Parameters<typeof authorizeAgentTurnV2>[0]['course_bonus']>={enabled:true,max_bonus_courses:3,may_offer_bonus:false,
      status:'offer_available',package_status:'offered',may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,
      may_send_promoted_payment:false,promotion_code:'p',interest_offering_code:'redes_informaticas',
      bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],
      delivered_bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]};
    const result=authorizeAgentTurnV2({state:state({selected_offering_code:source==='durable'?'redes_informaticas':null}),
      offerings:offerings.filter(course=>course.code!=='redes_informaticas'),facts:[],course_bonus:cap,
      semantic_rejections:'advisory',call_policy:{may_offer_call:false,may_request_call_now:false},
      proposal:proposal({response:{messages:['Redes Informáticas con Excel Integral.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}]})});
    expect(result).toMatchObject({ok:true,action:{type:'none'},transition:{selected_offering_code:source==='durable'?'redes_informaticas':null}});
  });
  it('does not replace an inactive durable primary with another delivered package identity',()=>{
    const result=authorizeAgentTurnV2({state:state({selected_offering_code:'inactive_paid'}),offerings,facts:[],
      course_bonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:false,status:'offer_available',package_status:'offered',
        may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:'p',
        interest_offering_code:'redes_informaticas',bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],
        delivered_bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]},
      semantic_rejections:'advisory',call_policy:{may_offer_call:false,may_request_call_now:false},
      proposal:proposal({response:{messages:['Redes Informáticas con Excel Integral.']},course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}]})});
    expect(result.ok).toBe(false);
  });
  it.each(['switch','reset'] as const)('does not resurrect an inactive durable primary after a validated %s',kind=>{
    const result=authorizeAgentTurnV2({state:state({selected_offering_code:'inactive_paid',stage:kind==='reset'?'closed':'course_selected'}),
      offerings,facts:[],semantic_rejections:'advisory',call_policy:{may_offer_call:false,may_request_call_now:false},
      course_bonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:false,status:'offer_available',package_status:'offered',
        may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:'p',
        interest_offering_code:'inactive_paid',bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],
        delivered_bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]},
      proposal:proposal({move:{schema_version:1,move:kind==='reset'?'browse_catalog':'select_course',secondary_moves:[],vetoes:[],confidence:1,
        ...(kind==='switch'?{course_reference:'excel_integral'}:{})},response:{messages:['Podemos continuar.']},
        course_mentions:[{offering_code:'inactive_paid',role:'paid'}]})});
    expect(result).toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED']});
  });
  it('keeps an inactive durable identity when an unresolved proposal cannot actually change it',()=>{
    const result=authorizeAgentTurnV2({state:state({selected_offering_code:'inactive_paid'}),offerings,facts:[],
      semantic_rejections:'advisory',call_policy:{may_offer_call:false,may_request_call_now:false},
      proposal:proposal({move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],confidence:1,course_reference:'unknown_course'},
        response:{messages:['Podemos continuar.']},course_mentions:[{offering_code:'inactive_paid',role:'paid'}]})});
    expect(result).toMatchObject({ok:true,transition:{selected_offering_code:'inactive_paid'}});
  });
  it('blocks an undeclared extra course even in advisory mode and call_offer',()=>{
    const result=authorize({state:state({selected_offering_code:'redes_informaticas'}),semanticRejections:'advisory',
      proposal:proposal({response:{messages:['Redes Informáticas puede servirte.'],call_offer:'Podemos revisar Excel Integral.'}})});
    expect(result).toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED'],rejection_subjects:['course_mentions:undeclared:excel_integral']});
  });
  it('rejects a declared paid role contradicting the validated current selection',()=>{
    const result=authorize({state:state({selected_offering_code:'redes_informaticas'}),
      proposal:proposal({response:{messages:['Excel Integral puede servirte.']},course_mentions:[{offering_code:'excel_integral',role:'paid'}]})});
    expect(result).toMatchObject({ok:false,reasons:['COURSE_ROLE_UNDECLARED']});
  });
  it('accepts current validated course selection without deriving purchase authority from metadata',()=>{
    const result=authorize({state:state({selected_offering_code:'redes_informaticas'}),proposal:proposal({
      move:{schema_version:1,move:'select_course',secondary_moves:[],vetoes:[],course_reference:'excel_integral',confidence:1},
      response:{messages:['Excel Integral puede servirte.']},course_mentions:[{offering_code:'excel_integral',role:'paid'}]})});
    expect(result).toMatchObject({ok:true,transition:{selected_offering_code:'excel_integral'}});
  });
  it('permits an explicit separately paid complement, but no effectless bonus role',()=>{
    const base=proposal({response:{messages:['Redes Informáticas y Excel Integral pueden servirte.']},course_mentions:[{offering_code:'excel_integral',role:'paid_complement'}]});
    expect(authorize({state:state({selected_offering_code:'redes_informaticas'}),proposal:base})).toMatchObject({ok:true});
    expect(authorize({state:state({selected_offering_code:'redes_informaticas'}),semanticRejections:'advisory',
      proposal:{...base,course_mentions:[{offering_code:'excel_integral',role:'bonus'}]}})).toMatchObject({ok:false,reasons:['COMMERCIAL_TRUTH_VIOLATION'],rejection_subjects:['forbidden_promise']});
  });

  it.each(['closed', 'payment_link_sent'] as const)(
    'starts a fresh call-offer budget when a completed %s sale switches to another course',
    previousStage => {
      const result = authorize({
        state: state({
          selected_offering_code: 'excel_integral',
          selected_payment_plan: 'one_time',
          stage: previousStage,
          call_preference: 'chat',
          call_offer_status: 'declined',
          call_offer_count: 2,
        }),
        customerText: 'Ahora quiero Redes Informáticas',
        proposal: proposal({
          move: {
            schema_version: 1,
            move: 'select_course',
            secondary_moves: [],
            vetoes: [],
            course_reference: 'redes',
            confidence: 1,
          },
          response: { messages: ['Redes Informáticas encaja con lo que querés aprender.'] },
        }),
      });

      expect(result).toMatchObject({
        ok: true,
        transition: {
          selected_offering_code: 'redes_informaticas',
          selected_payment_plan: null,
          stage: 'course_selected',
          call_preference: 'unknown',
          call_offer_status: 'not_offered',
          call_offer_count: 0,
        },
      });
    },
  );

  it('starts a fresh exploratory sale and spends only its first call invitation before course selection', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'excel_integral',
        selected_payment_plan: 'one_time',
        stage: 'closed',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 2,
        payment_reported_at: '2026-10-20T12:00:00.000Z',
      }),
      mayOfferCall: true,
      customerText: 'No sé si Redes Informáticas es para mí',
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 1,
        },
        response: {
          messages: ['Te cuento cómo puede encajar con lo que buscás.'],
          call_offer: 'Si querés, te llamo y vemos juntos si este curso es el indicado para vos.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      discussed_offering_code: 'redes_informaticas',
      transition: {
        selected_offering_code: null,
        selected_payment_plan: null,
        stage: 'exploring',
        call_preference: 'unknown',
        call_offer_status: 'offered',
        call_offer_count: 1,
        awaiting_reply: 'call_or_chat',
        payment_reported: false,
        reset_payment_reported: true,
      },
    });
  });

  it('counts select-course plus call as the first invitation of the new sales cycle', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'excel_integral',
        stage: 'closed',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 2,
      }),
      mayOfferCall: true,
      customerText: 'Quiero Redes Informáticas pero tengo dudas',
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'select_course',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 1,
        },
        response: {
          messages: ['Redes Informáticas queda como foco y podemos revisar tus dudas.'],
          call_offer: 'Si querés, te llamo y lo vemos con calma.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
        call_offer_status: 'offered',
        call_offer_count: 1,
      },
    });
  });

  it('preserves checkout and package identity when asking about an included bonus course', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'payment_link_sent',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 2,
        payment_link_request: {
          status: 'consumed',
          offering_code: 'redes_informaticas',
          payment_plan: 'one_time',
          requested_by_turn_id: null,
          resolved_by_decision_id: null,
        },
      }),
      customerText: 'Qué incluye Excel, que viene bonificado?',
      courseBonus: {
        enabled: false,
        max_bonus_courses: 2,
        may_offer_bonus: false,
        status: 'accepted',
        package_status: 'attached',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
        delivered_bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        course_mentions:[{offering_code:'excel_integral',role:'bonus'}],
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'excel',
          confidence: 1,
        },
        response: { messages: ['Te cuento qué incluye Excel Integral dentro de tu paquete.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      discussed_offering_code: 'excel_integral',
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'payment_link_sent',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 2,
        payment_link_request: { status: 'consumed', offering_code: 'redes_informaticas' },
      },
    });
  });

  it('preserves the paid package when the customer requests a call about its bonus course', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'payment_link_sent',
        call_preference: 'unknown',
        call_offer_status: 'not_offered',
        call_offer_count: 0,
        payment_link_request: {
          status: 'consumed',
          offering_code: 'redes_informaticas',
          payment_plan: 'one_time',
          requested_by_turn_id: null,
          resolved_by_decision_id: null,
        },
      }),
      customerText: 'Llamame para explicarme Excel, que viene incluido',
      courseBonus: {
        enabled: false,
        max_bonus_courses: 2,
        may_offer_bonus: false,
        status: 'accepted',
        package_status: 'attached',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'request_call',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'excel',
          confidence: 1,
        },
        response: { messages: ['Claro, coordinemos la llamada para revisar Excel dentro de tu paquete.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      discussed_offering_code: 'excel_integral',
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'payment_link_sent',
        call_preference: 'call',
        call_offer_status: 'accepted',
        payment_link_request: { status: 'consumed', offering_code: 'redes_informaticas' },
      },
    });
  });

  it('keeps the call-offer ledger when the customer compares courses inside the same active sale', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'excel_integral',
        stage: 'exploring',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 1,
      }),
      customerText: 'Me interesa más Redes Informáticas',
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'select_course',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 1,
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_offering_code: 'redes_informaticas',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 1,
      },
    });
  });

  it.each([
    {from:'excel_integral',to:'redes_informaticas',reference:'redes',blocked:true},
    {from:'redes_informaticas',to:'excel_integral',reference:'excel',blocked:false},
  ])('checks superseded package identity for combined $from -> $to checkout',({from,to,reference,blocked})=>{
    const result=authorize({state:state({selected_offering_code:from}),intake:completeIntake,
      customerText:'Quiero este curso en un pago, pasame el link de pago',
      courseBonus:{status:'accepted',package_status:'attached',interest_offering_code:'redes_informaticas',promotion_code:'old',
        may_send_promoted_payment:false,may_accept_offer:false,may_request_review:false,may_schedule_checkin:false,
        bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]},
      proposal:proposal({move:{schema_version:1,move:'select_course',secondary_moves:['select_payment_plan','request_payment_link'],
        course_reference:reference,payment_plan:'one_time',vetoes:[],confidence:1},
        proposed_action:{type:'send_payment_link',offering_code:to,payment_plan:'one_time'}})});
    expect(result).toMatchObject(blocked ? {ok:false,reasons:['ACTION_NOT_AUTHORIZED']}
      : {ok:true,action:{type:'send_payment_link',offering_code:to,payment_plan:'one_time'}});
  });
  it('owner 2026-11-10: an authorized paid+bonus action passes although the old course is still selected', () => {
    // Fotografía (camaras_seguridad here) was selected; the customer moved to Plomería
    // (redes_informaticas) and asked which course is included. The action declares the
    // paid and the bonus course and both are in the capability: the copy that names
    // both must not be rejected because it also names the paid course.
    const cap: NonNullable<Parameters<typeof authorizeAgentTurnV2>[0]['course_bonus']> = { status: 'checkin_available', enabled: true, max_bonus_courses: 2,
      ladder: { retention_used: false, previous_turn_asked_price_question: false },
      may_offer_bonus: true, may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: false, may_send_promoted_payment: false, promotion_code: null,
      interest_offering_code: 'redes_informaticas', bonus_offerings: [],
      bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }] };
    const p = proposal({ move: PRICE_MOVE,
      response: { messages: ['Con Redes Informáticas te queda incluido Excel Integral, sin costo extra.'] },
      course_mentions: [{ offering_code: 'redes_informaticas', role: 'paid' }, { offering_code: 'excel_integral', role: 'bonus' }],
      proposed_action: { type: 'offer_course_bonus', motive:{kind:'price_objection',quote:'me parece muy caro'},
        interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' } });
    expect(authorize({ proposal: p, state: state({ selected_offering_code: 'camaras_seguridad' }),
      customerText: 'me parece muy caro', courseBonus: cap })).toMatchObject({ ok: true, action: p.proposed_action });
  });
  it('authorizes exactly one active direct course only with the capability', () => {
    const p = proposal({ move: PRICE_MOVE, response: { messages: ['Te sumo Excel Integral y el precio sigue igual.'] },
      course_mentions: [{ offering_code: 'redes_informaticas', role: 'paid' }, { offering_code: 'excel_integral', role: 'bonus' }],
      proposed_action: { type: 'offer_course_bonus',
      motive:{kind:'price_objection',quote:'me parece muy caro'}, interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' } });
    const cap: NonNullable<Parameters<typeof authorizeAgentTurnV2>[0]['course_bonus']> = { status: 'checkin_available', enabled: true, max_bonus_courses: 2,
      ladder: { retention_used: false, previous_turn_asked_price_question: false },
      may_offer_bonus: true, may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: false, may_send_promoted_payment: false, promotion_code: null,
      interest_offering_code: 'redes_informaticas', bonus_offerings: [],
      bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }] };
    expect(authorize({ proposal: p, state: state({selected_offering_code:'redes_informaticas'}), customerText: 'me parece muy caro',
      courseBonus: cap })).toMatchObject({ok:true, action:p.proposed_action});
    const neutral = { ...p, response: { messages: ['Seguimos con tu curso.'] }, course_mentions: [] };
    expect(authorize({ proposal:neutral, state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:{...cap,enabled:false}, actionRejections:'structured' }))
      .toMatchObject({ok:true, action:{type:'none'}});
    // A rejected effect rejects only the effect: the copy that names the gift as a bonus is the false claim.
    expect(authorize({ proposal:{...p, response:{messages:['Te sumo Excel Integral sin costo.']}},
      state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:{...cap,enabled:false}, actionRejections:'structured' }))
      .toMatchObject({ok:false, rejection_subjects:['forbidden_promise','direct_bonus:bonus_disabled']});
    // A course outside the authorized set (affinity row, bridges, named literally) is rejected.
    expect(authorize({ proposal:neutral, state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:{...cap,bonus_candidates:[{code:'camaras_seguridad',display_name:'Cámaras'}]} }))
      .toMatchObject({ok:true, action:{type:'none'}});
  });
  // Bonus by current-message motive (AGENTS.md "Bonificación por motivo actual"): the model proposes with
  // motive {kind, quote}; the backend validates structure and literal facts of the CURRENT batch only.
  type Kind = 'price_objection' | 'promotion_rejection' | 'better_promotion_request' | 'purchase_decline';
  const MOVE = (move: string, secondary: string[] = []) => ({ schema_version: 1 as const, move: move as never, secondary_moves: secondary as never[], vetoes: [] as never[], confidence: 0.9 });
  const DELIVERED = { bonus_offerings: [{ code: 'camaras_seguridad', display_name: 'Cámaras', position: 1 }],
    delivered_bonus_offerings: [{ code: 'camaras_seguridad', display_name: 'Cámaras', position: 1 }],
    status: 'offer_available', package_status: 'offered', promotion_code: 'p' };
  const ruleCap = (delivered: boolean, extra: Record<string, unknown> = {}) => ({ status: 'checkin_available' as const, enabled: true, max_bonus_courses: 3 as const, may_offer_bonus: true,
    ladder: { retention_used: false, previous_turn_asked_price_question: false },
    may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
    promotion_code: null, interest_offering_code: 'redes_informaticas', bonus_offerings: [],
    bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }, { code: 'community_manager', display_name: 'Community Manager' }],
    ...(delivered ? DELIVERED : {}), ...extra });
  const bonusProposal = (o: { kind?: Kind; quote?: string; move?: ReturnType<typeof MOVE>; text?: string;
    code?: string; mentions?: Array<{ offering_code: string; role: 'paid' | 'bonus' }>; memory?: Array<{ type: string; key: string; value: string; source_quote: string; confidence: number }> } = {}) => {
    const code = o.code ?? 'excel_integral';
    const name = code === 'community_manager' ? 'Community Manager' : 'Excel Integral';
    return proposal({
      move: o.move ?? PRICE_MOVE,
      response: { messages: [o.text ?? `Te sumo ${name} sin costo; el precio de Redes Informáticas sigue igual. Avanzamos?`] },
      course_mentions: o.mentions ?? [{ offering_code: 'redes_informaticas', role: 'paid' }, { offering_code: code, role: 'bonus' }],
      proposed_action: { type: 'offer_course_bonus', motive: { kind: o.kind ?? 'price_objection', quote: o.quote ?? 'me parece muy caro' },
        interest_offering_code: 'redes_informaticas', bonus_offering_code: code },
      memory_candidates: (o.memory ?? []) as never });
  };
  const decline = { type: 'objection', key: 'purchase_decline', value: 'no', source_quote: 'no gracias, lo dejo', confidence: 1 };
  const rejectedBy = (reason: string) => ({ ok: false, rejection_subjects: expect.arrayContaining([`direct_bonus:${reason}`]) });
  const motiveRejected = { ok: false, rejection_subjects: expect.arrayContaining(['direct_bonus:ladder_step_pending', 'bonus_ladder:missing:current_message_motive']) };
  const selected = () => state({ selected_offering_code: 'redes_informaticas' });
  const run = (customerText: string, p: AgentATurnProposalV1, courseBonus: unknown) =>
    authorize({ state: selected(), customerText, proposal: p, courseBonus: courseBonus as never });
  const noClaim = 'Entiendo, te explico cómo funciona lo que ya tienes incluido.';

  it('a price complaint in the current message authorizes the first bonus', () => {
    expect(run('me parece muy caro', bonusProposal(), ruleCap(false))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
  });
  it('no instant trigger: a promo request whose quote is not in the current message is rejected', () => {
    expect(run('me hacés un descuento?', bonusProposal(), ruleCap(false))).toMatchObject(motiveRejected);
  });
  it('REAL TRACE: after the first bonus, a clarification ("me regalas otro curso?", "dos por uno?") is not a motive', () => {
    const batch = 'osea me regalas otro curso? dos por uno?';
    const clarification = MOVE('ask_course_information');
    // The model proposed a price_objection motive quoting the clarification, with move ask_course_information.
    expect(run(batch, bonusProposal({ move: clarification, quote: 'osea me regalas otro curso?', code: 'community_manager' }), ruleCap(true)))
      .toMatchObject(motiveRejected);
    // Whatever kind it declares, a clarification move never matches.
    for (const kind of ['price_objection', 'promotion_rejection', 'better_promotion_request', 'purchase_decline'] as const)
      expect(run(batch, bonusProposal({ move: clarification, kind, quote: 'dos por uno?' }), ruleCap(true))).toMatchObject(motiveRejected);
    // Conversational text that makes no bonus claim is kept: only the effect is dropped.
    const kept = run(batch, bonusProposal({ move: clarification, quote: 'dos por uno?', text: noClaim, mentions: [], code: 'community_manager' }), ruleCap(true));
    expect(kept).toMatchObject({ ok: true, action: { type: 'none' }, response: noClaim });
  });
  it('explicit_promotion_request whose quote is not in the current batch is rejected', () => {
    expect(run('dos por uno?', bonusProposal({ move: MOVE('explicit_promotion_request'), kind: 'better_promotion_request',
      quote: 'quiero una mejor promo' }), ruleCap(true))).toMatchObject(motiveRejected);
  });
  it('a payment question never opens a bonus, whatever motive the proposal declares', () => {
    const question = '¿cómo sería el pago?';
    expect(run(question, bonusProposal({ move: MOVE('ask_payment_options'), quote: question, code: 'community_manager' }), ruleCap(true))).toMatchObject(motiveRejected);
    expect(run(question, bonusProposal({ move: MOVE('ask_payment_options', ['price_objection']), quote: question }), ruleCap(true))).toMatchObject(motiveRejected);
    expect(run(question, bonusProposal({ move: MOVE('ask_payment_options', ['explicit_promotion_request']), kind: 'better_promotion_request', quote: question }), ruleCap(true))).toMatchObject(motiveRejected);
    expect(run(question, bonusProposal({ move: MOVE('ask_payment_options'), quote: question, text: noClaim, mentions: [] }), ruleCap(true)))
      .toMatchObject({ ok: true, action: { type: 'none' } });
  });
  it('second step: a new complaint declared as price_objection with its quote is allowed', () => {
    expect(run('igual sigue siendo caro', bonusProposal({ quote: 'igual sigue siendo caro', code: 'community_manager' }), ruleCap(true)))
      .toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
  });
  it('"dale, quiero pagar" is a buying signal, not a motive', () => {
    expect(run('dale, quiero pagar', bonusProposal({ move: MOVE('request_payment_link'), quote: 'dale, quiero pagar' }), ruleCap(true))).toMatchObject(rejectedBy('sale_already_closed'));
  });
  it('a persisted price objection alone never authorizes: any later reply without a motive in it is rejected', () => {
    // The old path read a persisted objection; the capability now carries no such evidence at all.
    for (const reply of ['ok', 'listo', 'y cuánto dura?'])
      expect(run(reply, bonusProposal({ quote: 'me sigue pareciendo caro' }), ruleCap(true))).toMatchObject(motiveRejected);
    expect(run('ok', bonusProposal({ move: MOVE('ask_course_information'), quote: 'ok' }), ruleCap(false))).toMatchObject(motiveRejected);
  });
  it('"sí, pero…": a bare "sí" quote needs the previous turn\'s structured price question and a whole fragment', () => {
    const asked = ruleCap(false, { ladder: { retention_used: false, previous_turn_asked_price_question: true } });
    const sí = bonusProposal({ quote: 'sí' });
    const síUpper = bonusProposal({ quote: 'Sí' });
    expect(authorize({ state: selected(), proposal: sí, courseBonus: ruleCap(false) as never, customerText: 'sí' })).toMatchObject(motiveRejected);
    expect(authorize({ state: selected(), proposal: sí, courseBonus: ruleCap(false) as never, customerText: 'sí, pero lo voy a pensar' })).toMatchObject(motiveRejected);
    expect(authorize({ state: selected(), proposal: sí, courseBonus: asked as never, customerText: 'sí, pero lo voy a pensar' })).toMatchObject(motiveRejected);
    expect(authorize({ state: selected(), proposal: sí, courseBonus: asked as never, customerText: 'sí' })).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
    expect(authorize({ state: selected(), proposal: síUpper, courseBonus: asked as never, customerText: 'Sí.' })).toMatchObject({ ok: true });
  });
  it('a question is never a price objection even with a coherent move', () => {
    expect(run('es muy caro?', bonusProposal({ quote: 'es muy caro' }), ruleCap(false))).toMatchObject(motiveRejected);
  });
  it('"me bonificas Community Manager?" with explicit_promotion_request is allowed within the limits', () => {
    const p = bonusProposal({ move: MOVE('explicit_promotion_request'), kind: 'better_promotion_request',
      quote: 'me bonificas Community Manager?', code: 'community_manager' });
    expect(run('me bonificas Community Manager?', p, ruleCap(true))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus', bonus_offering_code: 'community_manager' } });
    // First bonus: a promotion request before the price was presented goes back to the price question.
    expect(run('me bonificas Community Manager?', p, ruleCap(false))).toMatchObject(motiveRejected);
    // Same limits: an inactive/unauthorized course is still rejected.
    expect(run('me bonificas Community Manager?', p, ruleCap(true, { bonus_candidates: [] }))).toMatchObject(rejectedBy('invalid_offering'));
  });
  it('promotion_rejection needs a delivered offer and a coherent move', () => {
    const p = bonusProposal({ move: MOVE('price_objection'), kind: 'promotion_rejection', quote: 'eso no me sirve' });
    expect(run('eso no me sirve', p, ruleCap(true))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
    expect(run('eso no me sirve', p, ruleCap(false))).toMatchObject(motiveRejected);
    expect(run('eso no me sirve', bonusProposal({ move: MOVE('ask_course_information'), kind: 'promotion_rejection', quote: 'eso no me sirve' }), ruleCap(true))).toMatchObject(motiveRejected);
  });
  it('H1: a bonus effect whose copy does not name the bonus course rejects only the effect', () => {
    const unnamed = proposal({ ...bonusProposal(), course_mentions: [], response: { messages: ['Te sumo otro curso sin costo; el precio sigue igual. Avanzamos?'] } });
    expect(run('me parece muy caro', unnamed, ruleCap(false))).toMatchObject({ ok: true, action: { type: 'none' } });
    const accented = proposal({ ...bonusProposal(), response: { messages: ['Te sumo EXCEL INTEGRAL sin costo.'] } });
    expect(run('me parece muy caro', accented, ruleCap(false))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
  });
  it('retention: a declared purchase decline with its memory authorizes once per conversation', () => {
    const p = (extra = {}) => bonusProposal({ move: MOVE('decline_purchase'), kind: 'purchase_decline', quote: 'no gracias, lo dejo', memory: [decline], ...extra });
    expect(run('no gracias, lo dejo', p(), ruleCap(false))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
    expect(run('no gracias, lo dejo', p(), ruleCap(false, { ladder: { retention_used: true, previous_turn_asked_price_question: false } }))).toMatchObject(motiveRejected);
    expect(run('no gracias, lo dejo', p({ memory: [] }), ruleCap(false))).toMatchObject(motiveRejected);
    expect(run('no gracias', p(), ruleCap(false))).toMatchObject(motiveRejected);
    expect(run('no gracias, lo dejo', p({ move: MOVE('ask_course_information') }), ruleCap(false))).toMatchObject(motiveRejected);
  });
  it('affinity is set membership; the paid course is never a bonus', () => {
    expect(run('me parece muy caro', bonusProposal(), ruleCap(false, { bonus_candidates: [{ code: 'camaras_seguridad', display_name: 'Cámaras' }] }))).toMatchObject(rejectedBy('invalid_offering'));
    expect(run('me parece muy caro', bonusProposal(), ruleCap(false, { bonus_candidates: [] }))).toMatchObject(rejectedBy('invalid_offering'));
    const paid = proposal({ move: PRICE_MOVE, proposed_action: { type: 'offer_course_bonus', motive: { kind: 'price_objection', quote: 'me parece muy caro' },
      interest_offering_code: 'redes_informaticas', bonus_offering_code: 'redes_informaticas' } });
    expect(run('me parece muy caro', paid, ruleCap(false))).toMatchObject({ ok: true, action: { type: 'none' } });
  });
  it('limits: three bonuses reached rejects the fourth; repeated course; one per action', () => {
    const three = [1, 2, 3].map(position => ({ code: `c${position}`, display_name: `C${position}`, position }));
    expect(run('igual sigue siendo caro', bonusProposal({ quote: 'igual sigue siendo caro' }),
      ruleCap(true, { bonus_offerings: three, delivered_bonus_offerings: three }))).toMatchObject(rejectedBy('bonus_limit_reached'));
    expect(run('me parece muy caro', bonusProposal(), ruleCap(true, { max_bonus_courses: 1 }))).toMatchObject(rejectedBy('bonus_limit_reached'));
    const dup = [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }];
    expect(run('me parece muy caro', bonusProposal(), ruleCap(true, { bonus_offerings: dup, delivered_bonus_offerings: dup }))).toMatchObject(rejectedBy('duplicate_bonus'));
  });
  // Owner 2026-11-05: before the link a price complaint may open the bonus; after the link or a close it may not.
  it('never after the link or a close (state only), even with a valid motive; allowed earlier in checkout', () => {
    for (const awaiting of ['payment_plan', 'payment_confirmation', 'contact_details'] as const)
      expect(authorize({ state: state({ selected_offering_code: 'redes_informaticas', awaiting_reply: awaiting }), customerText: 'me parece muy caro',
        proposal: bonusProposal(), courseBonus: ruleCap(true) as never })).not.toMatchObject(rejectedBy('sale_already_closed'));
    for (const stage of ['payment_link_sent', 'closed'] as const)
      expect(authorize({ state: state({ selected_offering_code: 'redes_informaticas', stage }), customerText: 'me parece muy caro',
        proposal: bonusProposal(), courseBonus: ruleCap(true) as never })).toMatchObject(rejectedBy('sale_already_closed'));
  });
  it('a literal swap of the single bonus adds no course and needs no motive', () => {
    const swapCap = ruleCap(true, { bonus_candidates: [],
      rule_bonus: { paid_offering_code: 'redes_informaticas', paid_display_name: 'Redes Informáticas', bonus_offering_code: 'excel_integral',
        display_name: 'Excel Integral', position: 1, source: 'customer_request', replaces_offering_code: 'camaras_seguridad', replaces_display_name: 'Cámaras' } });
    expect(run('cambiame cámaras por excel integral', bonusProposal({ move: MOVE('ask_course_information'), quote: 'zzz' }), swapCap))
      .toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
  });
  // Owner 2026-11-09: with the paid course clear and its price already presented, an explicit
  // discount/promotion request in the current message is enough for the first bonus. The model
  // interprets the request (move + motive); the backend checks facts, permissions and limits.
  describe('explicit discount request after the price was presented', () => {
    const priced = (delivered: boolean, extra: Record<string, unknown> = {}) =>
      ruleCap(delivered, { ladder: { retention_used: false, previous_turn_asked_price_question: false, price_presented: true }, ...extra });
    const ask = (quote: string, code = 'excel_integral') => bonusProposal({ move: MOVE('explicit_promotion_request'),
      kind: 'better_promotion_request', quote, code });
    for (const request of ['me hacés un descuento?', 'podés bajar el precio?', 'Tenés alguna promoción?', 'no tenés alguna oferta?'])
      it(`"${request}" with course and price clear authorizes the first bonus`, () => {
        expect(run(request, ask(request), priced(false))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus',
          bonus_offering_code: 'excel_integral', interest_offering_code: 'redes_informaticas',
          motive: { kind: 'better_promotion_request', quote: request } } });
      });
    it('"podés bajar el precio?" adds a related course and never changes the paid course or its price', () => {
      // The effect carries no amount: the paid course stays the same; a lowered amount in the copy is
      // rejected at egress by enforceCommercialTruthV1 (commercial-truth-guard.test.ts).
      const result = run('podés bajar el precio?', ask('podés bajar el precio?'), priced(false));
      expect(result).toMatchObject({ ok: true, action: { type: 'offer_course_bonus', interest_offering_code: 'redes_informaticas' } });
      expect(JSON.stringify((result as { action: unknown }).action)).not.toMatch(/price|amount|discount/u);
    });
    it('the same request before the price was presented does not open the first bonus', () => {
      expect(run('me hacés un descuento?', ask('me hacés un descuento?'), ruleCap(false))).toMatchObject(motiveRejected);
    });
    it('a bare price question ("cuánto cuesta?") declared as such, or before the price, is not a bonus motive', () => {
      // Model-owned risk (owner: no commercial regex in the backend): once the price was presented, a question
      // the model MISLABELS as explicit_promotion_request is not detected here; evals cover the labeling.
      expect(run('cuánto cuesta?', bonusProposal({ move: MOVE('ask_course_information'), kind: 'better_promotion_request',
        quote: 'cuánto cuesta?' }), priced(false))).toMatchObject(motiveRejected);
      expect(run('cuánto cuesta?', ask('cuánto cuesta?'), ruleCap(false))).toMatchObject(motiveRejected);
      expect(run('cuánto cuesta?', bonusProposal({ quote: 'cuánto cuesta?' }), priced(false))).toMatchObject(motiveRejected);
    });
    it('a payment question ("cómo se paga?") is never a bonus motive', () => {
      expect(run('cómo se paga?', bonusProposal({ move: MOVE('ask_payment_options', ['explicit_promotion_request']),
        kind: 'better_promotion_request', quote: 'cómo se paga?' }), priced(false))).toMatchObject(motiveRejected);
    });
    it('without a clear paid course the promotion is not materialized yet', () => {
      expect(authorize({ state: state({ selected_offering_code: null }), customerText: 'me hacés un descuento?',
        proposal: ask('me hacés un descuento?'), courseBonus: priced(false, { interest_offering_code: null }) as never }))
        .not.toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
    });
    it('without authorized candidates there is no bonus', () => {
      expect(run('me hacés un descuento?', ask('me hacés un descuento?'), priced(false, { bonus_candidates: [] })))
        .toMatchObject(rejectedBy('invalid_offering'));
    });
    it('never after acceptance, the link, a payment or a close', () => {
      expect(run('me hacés un descuento?', ask('me hacés un descuento?', 'community_manager'),
        priced(true, { status: 'accepted', package_status: 'accepted' }))).toMatchObject(rejectedBy('sale_already_closed'));
      for (const stage of ['payment_link_sent', 'closed'] as const)
        expect(authorize({ state: state({ selected_offering_code: 'redes_informaticas', stage }), customerText: 'me hacés un descuento?',
          proposal: ask('me hacés un descuento?'), courseBonus: priced(false) as never })).toMatchObject(rejectedBy('sale_already_closed'));
    });
    it('second and third bonus each need a new valid request in the current message; never a fourth', () => {
      const one = [{ code: 'camaras_seguridad', display_name: 'Cámaras', position: 1 }];
      const two = [...one, { code: 'excel_integral', display_name: 'Excel Integral', position: 2 }];
      const three = [...two, { code: 'c3', display_name: 'C3', position: 3 }];
      // A reply without a motive ("ok") does not add the next course.
      expect(run('ok', ask('me hacés un descuento?', 'community_manager'), priced(true))).toMatchObject(motiveRejected);
      expect(run('y otro descuento más?', ask('y otro descuento más?', 'community_manager'),
        priced(true, { bonus_offerings: one, delivered_bonus_offerings: one }))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
      expect(run('no me podés mejorar algo?', ask('no me podés mejorar algo?', 'community_manager'),
        priced(true, { bonus_offerings: two, delivered_bonus_offerings: two }))).toMatchObject({ ok: true, action: { type: 'offer_course_bonus' } });
      expect(run('dale, otra promo', ask('dale, otra promo', 'community_manager'),
        priced(true, { bonus_offerings: three, delivered_bonus_offerings: three }))).toMatchObject(rejectedBy('bonus_limit_reached'));
    });
  });
  it('replaces a stale course before handing an exact current course to the call', () => {
    const result = authorizeAgentTurnV2({
      state: state({
        selected_offering_code: 'fotografia_profesional',
        selected_payment_plan: 'one_time',
        stage: 'course_selected',
      }),
      offerings: [
        { code: 'fotografia_profesional', display_name: 'Fotografía Profesional' },
        { code: 'ingles_1', display_name: 'Inglés 1' },
      ],
      facts: [{
        id: 'offering:ingles_1:name:v1', kind: 'offering_name', source: 'business_snapshot',
        value: 'Inglés 1', offering_code: 'ingles_1',
      }],
      contact_intake: completeIntake,
      current_customer_messages: ['Me puedes llamar?'],
      call_policy: { may_offer_call: true, may_request_call_now: false },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [],
          course_reference: 'ingles_1', confidence: 1,
        },
        response: { messages: ['Claro. Puedes atender ahora?'] },
        used_fact_ids: ['offering:ingles_1:name:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_offering_code: 'ingles_1',
        selected_payment_plan: null,
        stage: 'course_selected',
      },
    });
  });

  it('consumes a pending payment-link request when the last contact field arrives', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
        payment_link_request: {
          status: 'pending', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
          requested_by_turn_id: null, resolved_by_decision_id: null,
        },
      }),
      intake: completeIntake,
      customerText: 'Mi teléfono es +54 9 11 1234 5678',
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Listo, te comparto el enlace seguro.'] },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none', payment_link_request: { status: 'consumed' } },
    });
  });

  it.each([
    ['pago 1', 'select_payment_plan', null, 'one_time'],
    ['12 pagos 30', 'select_payment_plan', null, 'monthly_12'],
    ['si', 'select_course', 'one_time', 'one_time'],
    ['si', 'ask_current_state', 'one_time', 'one_time'],
  ] as const)('persists the explicit payment request before dispatch without a duplicate request move: %s / %s', (text, kind, durablePlan, plan) => {
    const result = authorizeAgentTurnV2({
      state: state({ selected_offering_code: 'ingles_1', selected_payment_plan: durablePlan, stage: 'handoff' }),
      offerings: [{ code: 'ingles_1', display_name: 'Inglés 1' }],
      facts: [{ id: `payment:ingles_1:${plan}:label:v1`, kind: 'payment_plan_label', source: 'business_snapshot',
        value: plan === 'one_time' ? '1 pago de USD 360' : '12 pagos mensuales de USD 30', offering_code: 'ingles_1', payment_plan: plan }],
      contact_intake: completeIntake, current_customer_messages: [text],
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: kind, secondary_moves: [], vetoes: [], confidence: 1,
        ...(kind === 'select_payment_plan' ? { payment_plan: plan } : {}),
        ...(kind === 'select_course' ? { course_reference: 'ingles_1' } : {}) },
        proposed_action: { type: 'send_payment_link', offering_code: 'ingles_1', payment_plan: plan } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: plan, stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      payment_link_request: { status: 'pending' },
    } });
  });

  it('sends checkout when the customer answers the requested payment-plan choice', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'payment_plan',
      }),
      intake: completeIntake,
      customerText: '1 pago',
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'select_payment_plan',
          secondary_moves: [],
          vetoes: [],
          payment_plan: 'one_time',
          confidence: 1,
        },
        response: { messages: ['Listo, un pago único de USD 360.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link',
        offering_code: 'redes_informaticas',
        payment_plan: 'one_time',
      },
      transition: {
        selected_payment_plan: 'one_time',
        stage: 'payment_link_sent',
        awaiting_reply: 'none',
        payment_link_request: { status: 'consumed' },
      },
    });
  });

  it('keeps an explicit payment tool request pending during a fenced selection-only continuation', () => {
    const result = authorizeAgentTurnV2({ effects_allowed: false,
      state: state({ selected_offering_code: 'redes_informaticas' }), offerings, facts, contact_intake: completeIntake,
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: [],
        vetoes: [], payment_plan: 'one_time', confidence: 1 },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: 'one_time', payment_link_request: { status: 'pending', payment_plan: 'one_time' } } });
  });

  it.each(['mismatched course', 'mismatched plan', 'missing intake', 'paid', 'deferral', 'veto', 'payment report'] as const)(
    'keeps the explicit-only payment request subject to the existing %s boundary', condition => {
      const result = authorizeAgentTurnV2({
        state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'one_time' }),
        offerings, facts, contact_intake: condition === 'missing intake' ? undefined : completeIntake,
        paid_purchase: condition === 'paid' ? { offering_code: 'redes_informaticas', plan_code: 'one_time' } : undefined,
        call_policy: { may_offer_call: false, may_request_call_now: false },
        proposal: proposal({ move: { schema_version: 1,
          move: condition === 'deferral' ? 'defer_payment' : condition === 'payment report' ? 'report_payment' : 'ask_current_state',
          secondary_moves: [], vetoes: condition === 'veto' ? ['payment_link'] : [], confidence: 1 },
          proposed_action: { type: 'send_payment_link',
            offering_code: condition === 'mismatched course' ? 'unknown_course' : 'redes_informaticas',
            payment_plan: condition === 'mismatched plan' ? 'monthly_6' : 'one_time' } }),
      });
      expect(result).toEqual({ ok: false, reasons: [condition === 'missing intake' ? 'MISSING_INTAKE' : 'ACTION_NOT_AUTHORIZED'] });
    },
  );

  it.each(['none', 'send_payment_link'] as const)('keeps same-turn payment consent pending when effects are fenced: %s', actionType => {
    const result = authorizeAgentTurnV2({ effects_allowed: false,
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'handoff' }),
      offerings, facts, contact_intake: completeIntake,
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan',
        secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: 'one_time', confidence: 1 },
        proposed_action: actionType === 'none' ? { type: 'none' }
          : { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: 'one_time', stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      payment_link_request: { status: 'pending', offering_code: 'redes_informaticas', payment_plan: 'one_time' },
    } });
  });

  it('keeps accepted call consent instead of dispatching when effects are fenced', () => {
    const result = authorizeAgentTurnV2({ effects_allowed: false,
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      offerings, facts, contact_intake: completeIntake, current_customer_messages: ['Dale llamame'],
      call_policy: { may_offer_call: true, may_request_call_now: true },
      proposal: proposal({ move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat', stage: 'course_selected',
    } });
  });

  it('does not execute a temporary test payment in conversation-only mode', () => {
    const result = authorizeAgentTurnV2({ effects_allowed: false,
      state: state({ selected_offering_code: 'redes_informaticas' }), offerings, facts,
      contact_intake: completeIntake, call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
        proposed_action: { type: 'send_test_payment_link', offering_code: 'redes_informaticas' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: null, payment_link_request: null,
    } });
  });

  it.each(['1 pago', 'un pago de 360'])('persists Agent A same-turn canonical selection after handoff before sending a link: %s', customerText => {
    const result = authorizeAgentTurnV2({
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: null,
        stage: 'handoff', awaiting_reply: 'none' }),
      offerings, facts: [...facts, { id: 'payment:redes_informaticas:one_time:label:v1', kind: 'payment_plan_label',
        source: 'business_snapshot', value: '1 pago de USD 360', offering_code: 'redes_informaticas', payment_plan: 'one_time' }],
      contact_intake: completeIntake, current_customer_messages: [customerText],
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan',
        secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: 'one_time', confidence: 1 },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      selected_payment_plan: 'one_time', stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      payment_link_request: { status: 'pending' },
    } });
  });

  it.each([
    ['un pago de 360', 'monthly_6'],
    ['Antes dijiste 6 pagos. Prefiero la otra opción.', 'monthly_6'],
  ] as const)('persists only the structured Agent A choice rather than reinterpreting %s', (customerText, plan) => {
    const result = authorize({ customerText, intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: null }),
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan', secondary_moves: [],
        vetoes: [], payment_plan: plan, confidence: 1 } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' },
      transition: { selected_payment_plan: 'monthly_6', payment_link_request: null } });
  });

  it.each([
    ['unknown course', 'unlisted_course', 'monthly_6'],
    ['unavailable canonical plan', 'redes_informaticas', 'one_time'],
    ['unknown plan', 'redes_informaticas', 'monthly_3'],
  ])('keeps a link request without %s out of effects and pending state', (_case, offeringCode, planCode) => {
    const result = authorizeAgentTurnV2({
      state: state({ selected_offering_code: offeringCode, selected_payment_plan: null }),
      offerings, facts: facts.filter(fact => fact.payment_plan === 'monthly_6'),
      contact_intake: completeIntake, semantic_rejections: 'advisory',
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan',
        secondary_moves: ['request_payment_link'], vetoes: [], payment_plan: planCode, confidence: 1 },
        proposed_action: { type: 'send_payment_link', offering_code: offeringCode, payment_plan: planCode } } as Partial<AgentATurnProposalV1>),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' },
      transition: { selected_payment_plan: null, payment_link_request: null } });
  });

  it.each(['unknown new course', 'unknown new plan', 'missing new plan'])('does not turn %s into permission for the previous purchase', condition => {
    const result = authorizeAgentTurnV2({
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
      offerings, facts, contact_intake: completeIntake, semantic_rejections: 'advisory',
      call_policy: { may_offer_call: false, may_request_call_now: false },
      proposal: proposal({ move: { schema_version: 1,
        move: condition === 'unknown new course' ? 'select_course' : 'select_payment_plan',
        secondary_moves: condition === 'unknown new course' ? ['select_payment_plan', 'request_payment_link'] : ['request_payment_link'],
        course_reference: condition === 'unknown new course' ? 'invented course' : undefined,
        vetoes: [], payment_plan: condition === 'unknown new course' ? 'monthly_6'
          : condition === 'missing new plan' ? undefined : 'monthly_3', confidence: 1 },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' } } as Partial<AgentATurnProposalV1>),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' },
      transition: { selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', payment_link_request: null } });
  });

  it('allows a new link request after a historical unverified payment claim', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
        payment_reported_at: '2026-10-03T10:57:31.097Z' }),
      intake: completeIntake, customerText: 'y el link?',
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Ahí va. El enlace es de Stripe.'] },
      }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'send_payment_link',
      offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      transition: { payment_reported: true, payment_link_request: { status: 'consumed' } } });
  });

  it('resumes an explicitly requested durable plan after a prior payment deferral', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'none',
        payment_link_request: {
          status: 'withdrawn',
          offering_code: 'redes_informaticas',
          payment_plan: 'monthly_6',
          requested_by_turn_id: null,
          resolved_by_decision_id: null,
        },
      }),
      intake: completeIntake,
      customerText: 'Ahora sí, enviame el link de las seis cuotas',
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 1,
        },
        response: { messages: ['Acá tenés el enlace para avanzar con el pago.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
      },
      transition: {
        stage: 'payment_link_sent', awaiting_reply: 'none', payment_link_request: { status: 'consumed' },
      },
    });
  });

  it('preserves an accepted promotion when a generic link request resumes the durable plan', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Pasame el link',
      courseBonus: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code:'excel_integral',display_name:'Excel Integral',position:1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Acá tenés el enlace para avanzar.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas',
          payment_plan: 'monthly_12', promotion_code: 'redes_con_excel',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas',
        payment_plan: 'monthly_6', promotion_code: 'redes_con_excel',
      },
    });
  });

  it('preserves an accepted promotion when a generic link request omits the redundant action', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Pasame el link',
      courseBonus: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Acá tenés el enlace para avanzar.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas',
        payment_plan: 'monthly_6', promotion_code: 'redes_con_excel',
      },
    });
  });

  it('keeps an accepted package when checkout names its included course', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Entonces con Excel incluido, pasame el enlace',
      courseBonus: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          course_reference: 'excel', confidence: 1,
        },
        response: { messages: ['Perfecto, te comparto el enlace del paquete.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link',
        offering_code: 'redes_informaticas',
        payment_plan: 'one_time',
        promotion_code: 'redes_con_excel',
      },
    });
  });

  it('does not create a simple checkout while the offered package still needs acceptance', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Claro, pasame el link y va también Excel',
      actionRejections: 'structured',
      courseBonus: {
        status: 'offer_available',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: true,
        may_send_promoted_payment: false,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Perfecto, te comparto el enlace del paquete.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      advisory_reasons: ['ACTION_NOT_AUTHORIZED'],
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
      },
    });
  });

  it('does not charge only the bonus when a package offer is still awaiting acceptance', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'excel_integral',
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Claro, pasame el link y va también Excel',
      actionRejections: 'structured',
      courseBonus: {
        status: 'offer_available',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: true,
        may_send_promoted_payment: false,
        promotion_code: 'redes_con_excel',
        interest_offering_code: 'redes_informaticas',
        bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          course_reference: 'excel', confidence: 1,
        },
        response: { messages: ['Perfecto, te comparto el enlace.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'excel_integral', payment_plan: 'one_time',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      advisory_reasons: ['ACTION_NOT_AUTHORIZED'],
      transition: { stage: 'plan_selected' },
    });
  });

  it('does not carry an accepted promotion into checkout for another course', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Pasame el link',
      courseBonus: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'excel_con_redes',
        interest_offering_code: 'excel_integral',
        bonus_offerings: [{ code: 'redes_informaticas', display_name: 'Redes Informáticas', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Acá tenés el enlace para avanzar.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
      },
    });
    if (!result.ok || result.action.type !== 'send_payment_link') return;
    expect(result.action).not.toHaveProperty('promotion_code');
  });

  it('rejects an explicit promotion code that belongs to another course without dropping the reply', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      customerText: 'Pasame el link',
      actionRejections: 'structured',
      courseBonus: {
        status: 'accepted',
        may_schedule_checkin: false,
        may_request_review: false,
        may_accept_offer: false,
        may_send_promoted_payment: true,
        promotion_code: 'excel_con_redes',
        interest_offering_code: 'excel_integral',
        bonus_offerings: [{ code: 'redes_informaticas', display_name: 'Redes Informáticas', position: 1 }],
      },
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Te acompaño con la inscripción.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas',
          payment_plan: 'monthly_6', promotion_code: 'excel_con_redes',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Te acompaño con la inscripción.',
      action: { type: 'none' },
      advisory_reasons: ['ACTION_NOT_AUTHORIZED'],
    });
  });

  it('does not issue a new link when the selected purchase is verified paid', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
      intake: completeIntake, paymentVerified: true,
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Tu pago está confirmado.'] },
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      }),
    });
    expect(result).toMatchObject({ ok: false, reasons: ['ACTION_NOT_AUTHORIZED'] });
  });
  it('keeps valid conversational copy when semantic checks disagree and exposes only advisories', () => {
    const messages = [
      'Ya tengo todos tus datos registrados.',
      'El curso que estamos comparando tiene 12 clases.',
    ];
    const result = authorize({
      mayOfferCall: false,
      semanticRejections: 'advisory',
      proposal: proposal({
        response: { messages },
        used_fact_ids: ['offering:excel_integral:duration:v1'],
        move: {
          schema_version: 1,
          move: 'ask_course_information',
          secondary_moves: [],
          vetoes: [],
          course_reference: 'redes',
          confidence: 0.98,
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: messages.join('\n\n'),
      action: { type: 'none' },
      advisory_reasons: ['FACT_NOT_AUTHORIZED', 'UNSUPPORTED_STATE_ASSERTION'],
    });
  });

  it('rejects the temporary USD 0.50 verification link while contact intake is incomplete', () => {
    const result = authorize({
      customerText: 'Mandame el link de prueba de 0,50 dólares.',
      state: state({
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
      }),
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'request_payment_link',
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Dale, te paso el link de prueba de USD 0,50.'] },
        proposed_action: {
          type: 'send_test_payment_link',
          offering_code: 'redes_informaticas',
        },
      } as unknown as AgentATurnProposalV1),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('authorizes the temporary USD 0.50 verification link after contact intake is complete', () => {
    const result = authorize({
      customerText: 'Mandame el link de prueba de 0,50 dólares.',
      intake: completeIntake,
      state: state({
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
      }),
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'request_payment_link',
          secondary_moves: [],
          vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Dale, te paso el link de prueba de USD 0,50.'] },
        proposed_action: {
          type: 'send_test_payment_link',
          offering_code: 'redes_informaticas',
        },
      } as unknown as AgentATurnProposalV1),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_test_payment_link',
        offering_code: 'redes_informaticas',
      },
    });
  });

  it('counts a useful later invitation as the second and final call offer', () => {
    const result = authorize({
      customerText: 'Contame cuánto dura.',
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_offer_count: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' }),
      proposal: proposal({
        move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Tiene 16 clases.'], call_offer: 'Si querés, podemos coordinar una llamada.' },
        used_fact_ids: ['offering:redes_informaticas:duration:v1'],
      }),
    });
    expect(result).toMatchObject({
      ok: true,
      transition: { call_offer_count: 2, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
  });
  it('does not count a confirmed call acknowledgement as another optional offer', () => {
    const result = authorize({
      customerText: 'Sí, llamame ahora.', mayOfferCall: false,
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_offer_count: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' }),
      proposal: proposal({
        move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Perfecto, podemos coordinar una llamada ahora.'], call_offer: null },
        proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
      }),
    });
    expect(result).toMatchObject({ ok: true,
      response: 'Perfecto, podemos coordinar una llamada ahora.',
      action: { type: 'request_call_now', reason: 'accepted_offer' },
      transition: { call_offer_count: 1, call_offer_status: 'accepted', stage: 'handoff' },
    });
  });
  it('preserves model-owned copy while reducing a canonical course selection', () => {
    const result = authorize({
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Buena elección. Redes te puede servir si buscás una salida práctica.'] },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Buena elección. Redes te puede servir si buscás una salida práctica.',
      action: { type: 'none' },
      transition: { selected_offering_code: 'redes_informaticas', stage: 'course_selected' },
    });
  });

  it('keeps the conversation alive without mutating course state when a reference is ambiguous', () => {
    const result = authorize({
      mayOfferCall: false,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: { messages: ['Tenemos Redes Informáticas y Excel Integral.'] },
        course_mentions:[{offering_code:'redes_informaticas',role:'alternative'},{offering_code:'excel_integral',role:'alternative'}],
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Tenemos Redes Informáticas y Excel Integral.',
      transition: { selected_offering_code: null, stage: 'exploring' },
    });
  });

  it('rejects a detailed fact from a course other than the resolved course', () => {
    const result = authorize({
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 0.98,
        },
        response: { messages: ['Tiene 12 clases.'] },
        used_fact_ids: ['offering:excel_integral:duration:v1'],
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['FACT_NOT_AUTHORIZED'] });
  });

  it('rejects a false registration claim instead of rewriting the response', () => {
    const result = authorize({
      proposal: proposal({
        response: {
          messages: ['Ya tengo todos tus datos registrados.', 'Todavía me falta tu correo para continuar.'],
        },
      }),
    });

    expect(result).toEqual({
      ok: false,
      reasons: ['UNSUPPORTED_STATE_ASSERTION'],
      rejection_subjects: ['state:intake_recorded:v1'],
    });
  });

  it('rejects an answer left empty after removing a false state assertion', () => {
    const result = authorize({
      proposal: proposal({ response: { messages: ['Ya tengo todos tus datos registrados.'] } }),
    });

    expect(result).toEqual({
      ok: false,
      reasons: ['UNSUPPORTED_STATE_ASSERTION'],
      rejection_subjects: ['state:intake_recorded:v1'],
    });
  });

  it('authorizes a payment link only after a separate durable data-confirmation step', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, te comparto el link seguro para continuar.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6' },
      transition: { stage: 'payment_link_sent', selected_payment_plan: 'monthly_6' },
    });
  });

  it.each([
    'Sí, ¿cómo se paga?',
    '¿Hay un link?',
  ])('keeps the persisted plan for a contextual link request: %s', (customerText) => {
    const result = authorize({
      customerText,
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'one_time', confidence: 0.99,
        },
        response: { messages: ['Te comparto el enlace seguro para avanzar.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_12',
      },
      transition: { stage: 'payment_link_sent', selected_payment_plan: 'monthly_12' },
    });
  });

  it('sends the link when the customer selects a plan and explicitly requests it with complete intake', () => {
    const result = authorize({
      customerText: 'Mejor 6 cuotas, pasame el link.',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_12',
        stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: ['select_payment_plan'], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Te comparto el enlace seguro de las 6 cuotas.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
      },
      transition: {
        stage: 'payment_link_sent', selected_payment_plan: 'monthly_6',
        awaiting_reply: 'none',
      },
    });
  });

  it('sends the link when one turn both selects the first plan and explicitly requests checkout', () => {
    const result = authorize({
      customerText: 'okay\npero me pasas el link\nde 1 cuota',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'none',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: ['request_payment_link'],
          vetoes: [], payment_plan: 'one_time', confidence: 0.99,
        },
        response: { messages: ['Te comparto el enlace del pago único.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'one_time',
      },
      transition: {
        stage: 'payment_link_sent', selected_payment_plan: 'one_time', awaiting_reply: 'none',
        payment_link_request: { status: 'consumed', payment_plan: 'one_time' },
      },
    });
  });

  it('persists checkout intent when the plan is selected and waits for data reconfirmation', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan',
          secondary_moves: ['request_payment_link'], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Perfecto, avanzamos con esa opción.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
        payment_link_request: { status: 'pending', payment_plan: 'monthly_6' },
      },
    });
  });

  it('preserves a durable payment-link request and waits for confirmation after final intake', () => {
    const result = authorize({
      customerText: 'Mi teléfono es +54 9 11 1234 5678',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
        payment_link_request: {
          status: 'pending', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
          requested_by_turn_id: '44444444-4444-4444-8444-444444444444',
          resolved_by_decision_id: null,
        },
      } as Partial<ConversationStateV1>),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Listo, tus datos están completos. ¿Confirmas el plan para enviarte el enlace?'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
        payment_link_request: { status: 'pending' },
      },
    });
  });

  it('does not replace the selected course when the customer only asks about another one', () => {
    const result = authorize({
      customerText: 'Y cuánto dura Excel?',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [],
          course_reference: 'excel', confidence: 0.99,
        },
        response: { messages: ['Excel Integral tiene 12 clases.'] },
        course_mentions:[{offering_code:'excel_integral',role:'alternative'}],
        used_fact_ids: ['offering:excel_integral:duration:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      },
    });
  });

  it('does not regress a completed checkout when contact data is corrected afterwards', () => {
    const result = authorize({
      customerText: 'Corrijo mi correo: matia.nuevo@example.com',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent', awaiting_reply: 'none',
        payment_link_request: {
          status: 'consumed', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
          requested_by_turn_id: '44444444-4444-4444-8444-444444444444',
          resolved_by_decision_id: '55555555-5555-4555-8555-555555555555',
        },
      } as Partial<ConversationStateV1>),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Actualicé el correo.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none' },
    });
  });

  it('resends an already delivered link without reconfirming unchanged data', () => {
    const result = authorize({
      customerText: 'No encuentro el enlace, ¿me lo mandás de nuevo?',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent', awaiting_reply: 'none',
        payment_link_request: {
          status: 'consumed', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
          requested_by_turn_id: '44444444-4444-4444-8444-444444444444',
          resolved_by_decision_id: '55555555-5555-4555-8555-555555555555',
        },
      } as Partial<ConversationStateV1>),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Te lo comparto de nuevo.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
      },
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none' },
    });
  });

  it('accepts the model explicit resend action after a link was already delivered', () => {
    const result = authorize({
      customerText: 'Reenviame el link, por favor.',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'payment_link_sent', awaiting_reply: 'none',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Claro, te lo reenvío.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: {
        type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
      },
      transition: { stage: 'payment_link_sent', awaiting_reply: 'none' },
    });
  });

  it('records a payment report without sending another link or offering another call', () => {
    const result = authorize({
      customerText: 'Listo, ya pagué.',
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_12',
        stage: 'payment_link_sent', call_offer_count: 1, call_offer_status: 'offered',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'report_payment', secondary_moves: [], vetoes: [], confidence: 1 },
        response: {
          messages: ['Gracias por avisar. El equipo verificará la acreditación y, si se confirma, gestionará tu inscripción y acceso.'],
          call_offer: null,
        },
        proposed_action: { type: 'none' },
        used_fact_ids: [
          'state:payment_reported:v1',
          'process:human_verification:v1',
          'process:access_after_verification:v1',
        ],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'payment_link_sent', payment_reported: true, call_offer_count: 1 },
    });
  });

  it('waits for customer confirmation after the final contact detail completes durable intake', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
        payment_link_request: {
          status: 'pending',
          offering_code: 'redes_informaticas',
          payment_plan: 'monthly_6',
          requested_by_turn_id: null,
          resolved_by_decision_id: null,
        },
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Gracias, ya está completo.'] },
        proposed_action: { type: 'none' },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'plan_selected', awaiting_reply: 'payment_confirmation' },
    });
  });

  it('rejects a payment action when durable intake is incomplete', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', stage: 'plan_selected',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'request_payment_link', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toEqual({ ok: false, reasons: ['MISSING_INTAKE'] });
  });

  it('waits for contact details after a link request whose intake is incomplete', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: ['request_payment_link'],
          vetoes: [], payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Para avanzar, pasame los datos que faltan.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_payment_plan: 'monthly_6', stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      },
    });
  });

  it('does not send an explicit canonical link request in the contact-details turn', () => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
        stage: 'plan_selected', awaiting_reply: 'contact_details',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 0.99,
        },
        response: { messages: ['Gracias, ya está todo para compartirte el link seguro.'] },
        proposed_action: {
          type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
        },
      }),
    });

    expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
      stage: 'plan_selected', awaiting_reply: 'payment_confirmation',
      payment_link_request: { status: 'pending' },
    } });
  });

  it('allows one final call reminder after a soft preference to continue by chat', () => {
    const result = authorize({
      customerText: 'Me parece caro y no sé cuál plan elegir.',
      state: state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'chat', call_offer_count: 1, call_offer_status: 'offered',
        awaiting_reply: 'none',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: {
          messages: ['Por lo que me cuentas, el plan de menor cuota puede resultarte más cómodo.'],
          call_offer: 'Si quieres, también puedo llamarte y ayudarte a decidirlo.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        call_preference: 'chat', call_offer_count: 2,
        call_offer_status: 'offered', awaiting_reply: 'call_or_chat',
      },
    });
  });

  it('allows one later reminder after a prior call refusal', () => {
    const result = authorize({
      customerText: '¿Cuál plan me conviene?',
      state: state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_preference: 'declined', call_offer_count: 1, call_offer_status: 'declined',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1,
        },
        response: {
          messages: ['Te recomiendo empezar por la opción de menor cuota.'],
          call_offer: 'Si quieres, puedo llamarte y explicarte los planes.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response_messages: [
        'Te recomiendo empezar por la opción de menor cuota.',
        'Si quieres, puedo llamarte y explicarte los planes.',
      ],
      transition: {
        call_preference: 'chat', call_offer_count: 2, call_offer_status: 'offered',
      },
    });
  });

  it('counts a visible call offer without letting the backend write its wording', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      mayOfferCall: true,
      proposal: proposal({
        response: {
          messages: ['Por chat también puedo ayudarte.'],
          call_offer: 'Si preferís, coordinamos una llamada y lo vemos juntos.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response: 'Por chat también puedo ayudarte.\n\nSi preferís, coordinamos una llamada y lo vemos juntos.',
      response_messages: [
        'Por chat también puedo ayudarte.',
        'Si preferís, coordinamos una llamada y lo vemos juntos.',
      ],
      transition: { call_offer_count: 1, call_offer_status: 'offered', awaiting_reply: 'call_or_chat' },
    });
  });

  it('permits the first separate call invitation for a cited unresolved course family', () => {
    const result = authorize({
      mayOfferCall: true,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'browse_catalog', secondary_moves: [], vetoes: [], confidence: 0.98,
        },
        response: {
          messages: ['Tenemos niveles de Inglés para que elijas el que mejor te sirva.'],
          call_offer: 'Si preferís, podemos hablar por llamada y te ayudo a ubicarte.',
        },
        used_fact_ids: ['offering:redes_informaticas:name:v1'],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response_messages: [
        'Tenemos niveles de Inglés para que elijas el que mejor te sirva.',
        'Si preferís, podemos hablar por llamada y te ayudo a ubicarte.',
      ],
      transition: {
        selected_offering_code: null,
        call_offer_count: 1,
        call_offer_status: 'offered',
      },
    });
  });

  it('preserves the model messages when the first call invitation boundary is imperfect', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      mayOfferCall: true,
      proposal: proposal({
        response: {
          messages: [
            'Redes Informáticas es una opción práctica para tecnología.',
            'Puedo contarte también cómo se cursa.',
          ],
          call_offer: 'Si te sirve, coordinamos una llamada breve.',
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      response_messages: [
        'Redes Informáticas es una opción práctica para tecnología.',
        'Puedo contarte también cómo se cursa.',
        'Si te sirve, coordinamos una llamada breve.',
      ],
      transition: { call_offer_count: 1, call_offer_status: 'offered' },
    });
  });

  it.each([
    'Si querés, puedo contarte más en detalle cómo funciona el curso.',
    '¿Preferís que te explique el contenido por acá?',
    'Entendido, seguimos sin llamada.',
  ])('does not spend a call offer or wait for one merely because prose was placed in call_offer: %s', (text) => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      mayOfferCall: false,
      proposal: proposal({ response: { messages: ['Puedo ayudarte con el curso.'], call_offer: text } }),
    });
    expect(result).toMatchObject({
      ok: true,
      transition: { call_offer_count: 0, call_offer_status: 'not_offered', awaiting_reply: 'none' },
    });
    if (result.ok) expect(result.response).toContain(text);
  });

  it.each(['¿Querés que coordinemos una llamada?', '¿Hablamos por teléfono?', '¿Quieres que te llame para explicarte el curso?', 'Ya registré tus datos. ¿Hablamos por teléfono?', 'Ya registré tus datos, ¿Hablamos por teléfono?', 'Entendido, seguimos sin llamada. ¿Quieres que te llame para explicarte el curso?'])('rejects a third proactive call bubble for model repair: %s', (offer) => {
    const result = authorize({
      state: state({
        selected_offering_code: 'redes_informaticas', stage: 'course_selected',
        call_offer_count: 2, call_offer_status: 'offered',
      }),
      mayOfferCall: false,
      proposal: proposal({
        response: {
          messages: ['Seguimos por chat.'],
          call_offer: offer,
        },
      }),
    });

    expect(result).toMatchObject({
      ok: false,
      reasons: expect.arrayContaining(['CALL_OFFER_NOT_AUTHORIZED']),
    });
  });

  it('persists call refusal and a payment-plan choice from the same customer message', () => {
    const result = authorize({
      customerText: 'No quiero que me llamen; quiero pagar en un solo pago.',
      state: state({
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
        call_offer_status: 'offered',
        call_offer_count: 1,
        awaiting_reply: 'call_or_chat',
      }),
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'select_payment_plan',
          secondary_moves: ['decline_call'],
          vetoes: ['call'],
          payment_plan: 'one_time',
          confidence: 1,
        },
        response: { messages: ['Perfecto, seguimos por chat y dejo elegido el pago único.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'one_time',
        stage: 'plan_selected',
        call_preference: 'chat',
        call_offer_status: 'declined',
        call_offer_count: 1,
        awaiting_reply: 'payment_confirmation',
      },
    });
  });
});

// A pending intake carries link consent only after an explicit request.
describe('payment link consent across intake', () => {
  it('starts the checkout checkpoint when Agent A asks for payment contact data before a plan exists', () => {
    const result = authorize({
      customerText: 'Dale, quiero comprar Redes Informáticas',
      state: state(),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_course', secondary_moves: [], vetoes: [],
          course_reference: 'redes', confidence: 1,
        },
        response: { messages: ['Para avanzar, pasame nombre, apellido, correo y teléfono.'] },
        profile_requests: [{
          message_index: 0,
          fields: ['nombre', 'apellido', 'correo', 'telefono'],
          purpose: 'payment',
          mode: 'collect',
        }],
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'contact_details',
      },
    });
  });

  it('moves completed payment intake to confirmation without requiring a selected plan', () => {
    const result = authorize({
      customerText: 'Soy Ana Pérez, ana@example.com, +5491112345678',
      state: state({
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
        awaiting_reply: 'contact_details',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [],
          confidence: 1,
        },
        response: { messages: ['Te resumo los datos. ¿Están correctos?'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'payment_confirmation',
      },
    });
  });

  it('persists the payment-plan choice checkpoint after the customer confirms the data summary', () => {
    const result = authorize({
      customerText: 'Sí, están correctos',
      state: state({
        selected_offering_code: 'redes_informaticas',
        stage: 'course_selected',
        awaiting_reply: 'payment_confirmation',
      }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [],
          course_reference: 'redes_informaticas', confidence: 1,
        },
        response: { messages: ['¿Preferís 12 cuotas, 6 cuotas o un pago?'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'payment_plan',
      },
    });
  });

  it.each(['continue_by_chat', 'decline_call'] as const)(
    'preserves explicit link consent while the customer chooses %s', (chatMove) => {
      const result = authorize({
        customerText: 'No quiero una llamada, sigamos por chat y mandame el link.',
        state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
        proposal: proposal({
          move: { schema_version: 1, move: 'request_payment_link', secondary_moves: [chatMove], vetoes: [], confidence: 1 },
          response: { messages: ['Seguimos por acá. ¿Cuál es tu correo?'] },
        }),
      });
      expect(result).toMatchObject({ ok: true, transition: { awaiting_reply: 'contact_details' } });
    },
  );

  // 2026-11-05 replay (5b138536): the call intake stayed as a checkout after «sigamos por acá».
  it.each(['continue_by_chat', 'decline_call'] as const)('%s releases contact details owed only to a call', (chatMove) => {
    const result = authorize({
      customerText: 'okay sigamos por aca',
      state: state({ selected_offering_code: 'redes_informaticas', call_preference: 'call', call_offer_status: 'accepted',
        awaiting_reply: 'contact_details' }),
      proposal: proposal({
        move: { schema_version: 1, move: chatMove, secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Dale, seguimos por acá.'] },
      }),
    });
    expect(result).toMatchObject({ ok: true, transition: { call_preference: 'chat', awaiting_reply: 'none' } });
  });

  // 2026-11-05 owner test (6bcc8efa): «quiero pagar» for the course under
  // discussion left the state at exploring/no course, so the checkout
  // checkpoints (contact_details → payment_confirmation) never opened.
  it('purchase intent for an exact course selects it when no course is selected yet', () => {
    const result = authorize({
      customerText: 'quiero pagar',
      state: state({ selected_offering_code: null }),
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', course_reference: 'redes_informaticas',
          secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: ['Perfecto, avanzamos con Redes Informáticas. Necesito tu nombre, apellido y correo.'] },
        course_mentions: [{ offering_code: 'redes_informaticas', role: 'paid' }],
        profile_requests: [{ message_index: 0, fields: ['nombre', 'apellido', 'correo'], purpose: 'payment', mode: 'collect' }],
      }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' },
      transition: { selected_offering_code: 'redes_informaticas', stage: 'course_selected', awaiting_reply: 'contact_details' } });
  });
  it('purchase intent never replaces a different durable course selection', () => {
    const result = authorize({
      customerText: 'quiero pagar',
      state: state({ selected_offering_code: 'excel_integral', stage: 'course_selected' }),
      proposal: proposal({
        move: { schema_version: 1, move: 'request_payment_link', course_reference: 'redes_informaticas',
          secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: ['Perfecto. Necesito tu nombre, apellido y correo.'] },
        profile_requests: [{ message_index: 0, fields: ['nombre', 'apellido', 'correo'], purpose: 'payment', mode: 'collect' }],
      }),
    });
    expect(result).toMatchObject({ ok: true, transition: { selected_offering_code: 'excel_integral' } });
  });

  // 2026-11-05 owner test (6bcc8efa): after a voicemail the customer chose chat,
  // then picked «el de 12 cuotas» twice and only got the link on «y el link?».
  it.each(['continue_by_chat', 'decline_call'] as const)(
    '%s after a call resumes checkout when course and intake are complete', (chatMove) => {
      const resumed = authorize({
        customerText: 'nada, prefiero seguir por acá', intake: completeIntake,
        state: state({ selected_offering_code: 'redes_informaticas', stage: 'handoff', call_preference: 'call',
          call_offer_status: 'accepted', awaiting_reply: 'none' }),
        proposal: proposal({
          move: { schema_version: 1, move: chatMove, secondary_moves: [], vetoes: ['call'], confidence: 0.93 },
          response: { messages: ['Perfecto, seguimos por acá. Con cuál plan te acomodás mejor?'] },
        }),
      });
      expect(resumed).toMatchObject({ ok: true, transition: { call_preference: 'chat', awaiting_reply: 'payment_plan' } });
      if (!resumed.ok) throw Error('expected resumed checkout');
      const picked = authorize({
        customerText: 'el de 12 cuotas', intake: completeIntake,
        state: state({ selected_offering_code: 'redes_informaticas', stage: resumed.transition.stage,
          call_preference: 'chat', awaiting_reply: resumed.transition.awaiting_reply }),
        proposal: proposal({
          move: { schema_version: 1, move: 'select_payment_plan', payment_plan: 'monthly_12', course_reference: 'redes_informaticas',
            secondary_moves: [], vetoes: [], confidence: 0.95 },
          response: { messages: ['Listo, te paso el link de 12 pagos mensuales de USD 30.'] },
          used_fact_ids: ['payment:redes_informaticas:monthly_12:label:v1'],
          proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_12' },
        }),
      });
      expect(picked).toMatchObject({ ok: true,
        action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_12' } });
    },
  );
  // Golden case48-1f58fad p08/p09: the terminal-call reconciliation had already released the handoff
  // (course_selected, call_preference unknown) when the customer chose chat, so «el de 12 cuotas» failed again.
  it('chat choice after the call was reconciled still opens the plan checkpoint', () => {
    const resumed = authorize({ customerText: 'nada, prefiero seguir por acá', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected', call_preference: 'unknown',
        call_offer_status: 'not_offered', awaiting_reply: 'none' }),
      proposal: proposal({ move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'], confidence: 0.93 },
        response: { messages: ['Perfecto, seguimos por acá. Cómo prefieres pagar?'] } }) });
    expect(resumed).toMatchObject({ ok: true, transition: { awaiting_reply: 'payment_plan' } });
  });
  // Architect F1: the resumed checkpoint authorizes only a plan choice, never an unrequested link.
  it('a resumed plan checkpoint never authorizes a link the customer did not choose', () => {
    const resumed = authorize({ customerText: 'prefiero por acá, lo estoy pensando', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_12', stage: 'handoff',
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'none' }),
      proposal: proposal({ move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'], confidence: 0.9 },
        response: { messages: ['Perfecto, seguimos por acá.'] } }) });
    if (!resumed.ok) throw Error('expected resumed checkout');
    expect(resumed.transition.awaiting_reply).toBe('payment_plan');
    const unasked = authorize({ customerText: 'cuántas clases son?', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_12', stage: resumed.transition.stage,
        call_preference: 'chat', awaiting_reply: resumed.transition.awaiting_reply }),
      proposal: proposal({ move: { schema_version: 1, move: 'ask_course_information', secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: ['Son 16 clases. Te paso el link.'] }, used_fact_ids: ['offering:redes_informaticas:duration:v1'],
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_12' } }) });
    expect(unasked).not.toMatchObject({ ok: true, action: { type: 'send_payment_link' } });
  });
  // Architect F3: «quiero pagar» with the intake recorded and no plan opens the plan checkpoint.
  it('purchase intent with a recorded intake and no plan lets the next plan choice send the link', () => {
    const intent = authorize({ customerText: 'quiero pagar', intake: completeIntake,
      state: state({ selected_offering_code: null }),
      proposal: proposal({ move: { schema_version: 1, move: 'request_payment_link', course_reference: 'redes_informaticas',
        secondary_moves: [], vetoes: [], confidence: 0.9 },
        response: { messages: ['Perfecto. Cómo prefieres pagar?'] }, course_mentions: [{ offering_code: 'redes_informaticas', role: 'paid' }] }) });
    if (!intent.ok) throw Error('expected purchase intent');
    expect(intent.transition).toMatchObject({ selected_offering_code: 'redes_informaticas', awaiting_reply: 'payment_plan' });
    const picked = authorize({ customerText: 'el de 12 cuotas', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', stage: intent.transition.stage, awaiting_reply: intent.transition.awaiting_reply }),
      proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan', payment_plan: 'monthly_12', secondary_moves: [], vetoes: [], confidence: 0.95 },
        response: { messages: ['Listo, te paso el link de 12 pagos mensuales de USD 30.'] },
        used_fact_ids: ['payment:redes_informaticas:monthly_12:label:v1'],
        proposed_action: { type: 'send_payment_link', offering_code: 'redes_informaticas', payment_plan: 'monthly_12' } }) });
    expect(picked).toMatchObject({ ok: true, action: { type: 'send_payment_link', payment_plan: 'monthly_12' } });
  });
  it('a pending link request resumes the payment confirmation after the call', () => {
    const resumed = authorize({ customerText: 'sigamos por acá', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', stage: 'handoff',
        call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'none',
        payment_link_request: { status: 'pending', offering_code: 'redes_informaticas', payment_plan: 'monthly_6',
          requested_by_turn_id: null, resolved_by_decision_id: null } }),
      proposal: proposal({ move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'], confidence: 0.9 },
        response: { messages: ['Perfecto, seguimos por acá.'] } }) });
    expect(resumed).toMatchObject({ ok: true, transition: { awaiting_reply: 'payment_confirmation' } });
  });
  it.each(['defer_payment', 'decline_purchase'] as const)('%s together with the chat choice leaves no checkpoint', (move) => {
    const result = authorize({ customerText: 'sigamos por acá, pero lo pienso', intake: completeIntake,
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'handoff', call_preference: 'call',
        call_offer_status: 'accepted', awaiting_reply: 'none' }),
      proposal: proposal({ move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [move], vetoes: ['call'], confidence: 0.9 },
        response: { messages: ['Dale, seguimos por acá cuando quieras.'] } }) });
    if (result.ok) expect(result.transition.awaiting_reply).toBe('none');
  });
  it('choosing chat without a complete intake keeps the checkout closed', () => {
    const result = authorize({
      customerText: 'prefiero seguir por acá',
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'handoff', call_preference: 'call',
        call_offer_status: 'accepted', awaiting_reply: 'none' }),
      proposal: proposal({
        move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: ['call'], confidence: 0.93 },
        response: { messages: ['Perfecto, seguimos por acá.'] },
      }),
    });
    expect(result).toMatchObject({ ok: true, transition: { awaiting_reply: 'none' } });
  });

  it('changing course clears the former plan and pending link consent', () => {
    const result = authorize({
      mayOfferCall: false, // This fixture isolates course/fact authority when a call is unavailable.
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6', awaiting_reply: 'contact_details' }),
      intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'select_course', course_reference: 'excel', secondary_moves: ['provide_contact_details'], vetoes: [], confidence: 1 },
        response: { messages: ['Elegiste Excel Integral.'] },
      }),
    });
    expect(result).toMatchObject({
      ok: true, action: { type: 'none' },
      transition: { selected_offering_code: 'excel_integral', selected_payment_plan: null, awaiting_reply: 'none' },
    });
  });

  it('choosing a plan alone persists it without authorizing a link through intake', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: {
          messages: ['¡Excelente! Para dejarlo registrado necesito tu nombre, apellido, correo electrónico y teléfono.'],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: {
        selected_payment_plan: 'monthly_6', stage: 'plan_selected',
        awaiting_reply: 'payment_confirmation',
      },
    });
  });

  it('postponement cancels pending link consent before later contact details arrive', () => {
    const initialState = state({
      selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6',
      stage: 'plan_selected', awaiting_reply: 'contact_details',
    });
    const deferred = authorize({
      customerText: 'Todavía no, prefiero pagar más adelante.',
      state: initialState,
      proposal: proposal({
        move: { schema_version: 1, move: 'defer_payment', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Está bien, podés retomar cuando te quede cómodo.'] },
      }),
    });
    expect(deferred).toMatchObject({ ok: true, transition: { awaiting_reply: 'none' } });
    if (!deferred.ok) throw new Error('Expected safe postponement');
    const details = authorize({
      state: { ...initialState, ...deferred.transition }, intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'provide_contact_details', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Gracias por los datos.'] },
      }),
    });
    expect(details).toMatchObject({ ok: true, action: { type: 'none' } });
  });

  it('persists the model-owned payment deferral without reclassifying its wording', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'defer_payment', secondary_moves: [],
          vetoes: ['payment_link'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: { stage: 'plan_selected', awaiting_reply: 'none' },
    });
  });

  it('persists the model-owned purchase decline without reclassifying its wording', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.91,
        },
        response: { messages: ['¡Gracias, Inés!'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: { stage: 'closed', awaiting_reply: 'none' },
    });
  });

  it('closes the sale only when the current message explicitly declines the purchase', () => {
    const result = authorize({
      customerText: 'No quiero comprar el curso.',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'decline_purchase', secondary_moves: [],
          vetoes: ['purchase'], confidence: 0.99,
        },
        response: { messages: ['Entiendo. Si más adelante querés retomarlo, escribime.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'closed', awaiting_reply: 'none' },
    });
  });

  it.each([
    'No quiero comprar ahora.',
    'No me voy a inscribir todavía.',
  ])('treats a time-bounded refusal as deferral without closing the sale: %s', (customerText) => {
    const result = authorize({
      customerText,
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'defer_payment', secondary_moves: [],
          vetoes: ['payment_link'], confidence: 0.99,
        },
        response: { messages: ['Entiendo, podemos retomarlo cuando te quede cómodo.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: { stage: 'plan_selected', awaiting_reply: 'none' },
    });
  });

  it('rejects an unsupported state claim without rewriting the remaining acknowledgement', () => {
    const result = authorize({
      customerText: 'Inés',
      state: state({
        selected_offering_code: 'redes_informaticas',
        selected_payment_plan: 'monthly_6',
        stage: 'plan_selected',
        awaiting_reply: 'contact_details',
      }),
      proposal: proposal({
        move: {
          schema_version: 1, move: 'provide_contact_details', secondary_moves: [],
          vetoes: [], confidence: 0.99,
        },
        response: {
          messages: [
            'Gracias, Inés.',
            'Ya tengo tus datos registrados, ¿me pasás tu correo?',
          ],
        },
      }),
    });

    expect(result).toEqual({
      ok: false,
      reasons: ['UNSUPPORTED_STATE_ASSERTION'],
      rejection_subjects: ['state:intake_recorded:v1'],
    });
  });

  it('a postponement takes precedence over a conflicting link request', () => {
    const result = authorize({
      customerText: 'Todavía no me mandes el link; prefiero seguir más adelante.',
      state: state({ selected_offering_code: 'redes_informaticas', selected_payment_plan: 'monthly_6' }),
      intake: completeIntake,
      proposal: proposal({
        move: { schema_version: 1, move: 'defer_payment', secondary_moves: ['request_payment_link'], vetoes: [], confidence: 1 },
        response: { messages: ['Podés retomar cuando quieras.'] },
      }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'none' } });
  });

  it('con el intake ya registrado sí espera la confirmación del pago', () => {
    const result = authorize({
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      // El hecho `state:intake_recorded:v1` lo materializa la propia política
      // desde el intake completo; no se inyecta desde el test.
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1, move: 'select_payment_plan', secondary_moves: [], vetoes: [],
          payment_plan: 'monthly_6', confidence: 0.99,
        },
        response: { messages: ['Listo, quedó el plan de 6 pagos.'] },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      transition: { awaiting_reply: 'payment_confirmation' },
    });
  });

  it('does not infer a payment selection when Agent A has not emitted one', () => {
    const result = authorize({
      customerText: '1 pago de 360',
      state: state({ selected_offering_code: 'redes_informaticas', stage: 'course_selected' }),
      intake: completeIntake,
      proposal: proposal({
        move: {
          schema_version: 1,
          move: 'unknown',
          secondary_moves: [],
          vetoes: [],
          confidence: 0.99,
        },
        response: {
          messages: [
            'Pago único de USD 360.',
            'Tus datos están completos. Confirmas que son correctos para enviarte el link?',
          ],
        },
      }),
    });

    expect(result).toMatchObject({
      ok: true,
      action: { type: 'none' },
      transition: {
        selected_payment_plan: null,
        stage: 'course_selected',
        awaiting_reply: 'none',
      },
    });
  });
});


describe('durable call invitation limit', () => {
  it.each(['seguir por aca', 'lo vemos por este medio'])('persists the model channel choice without a second lexical classification: %s', text => {
    const result = authorize({ customerText: text, mayRequestCall: false,
      state: state({ call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 1 }),
      proposal: proposal({ move: { schema_version: 1, move: 'continue_by_chat', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Seguimos por aquí.'] } }),
    });
    expect(result).toMatchObject({ ok: true, transition: { call_preference: 'chat', call_offer_status: 'declined', call_offer_count: 1 } });
  });

  it.each(['narrative', 'dedicated'] as const)('rejects a third proactive invitation in %s for the model to repair', location => {
    const offer = location === 'dedicated' ? 'Quieres que te llame para orientarte?'
      : 'Si quieres, puedo llamarte para orientarte.';
    const result = authorize({ customerText: 'Tengo una duda', mayOfferCall: false,
      state: state({ call_preference: 'chat', call_offer_status: 'declined', call_offer_count: 2 }),
      proposal: proposal({ response: location === 'narrative'
        ? { messages: ['Podemos resolverla. '+offer] }
        : { messages: ['Podemos resolverla.'], call_offer: offer } }),
    });
    expect(result).toMatchObject({ ok: false, reasons: expect.arrayContaining(['CALL_OFFER_NOT_AUTHORIZED']) });
  });

  it('accepts a customer-initiated call after both invitations were declined without resetting the counter', () => {
    const result = authorize({ customerText: 'Ahora sí, llamame',
      state: state({ call_preference: 'chat', call_offer_status: 'declined', call_offer_count: 2 }),
      proposal: proposal({ move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
        response: { messages: ['Solicito la llamada al número que me pasaste.'] },
        proposed_action: { type: 'request_call_now', reason: 'direct_request' } }),
    });
    expect(result).toMatchObject({ ok: true, action: { type: 'request_call_now' },
      transition: { call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 2 } });
  });
});

it('resumes durable customer call consent without requiring a new agent offer', () => {
  const result = authorize({
    customerText: 'Mi teléfono es +54 9 11 5555 0101',
    state: state({ call_preference: 'call', call_offer_status: 'accepted', call_offer_count: 0 }),
    mayRequestCall: true,
    proposal: proposal({
      move: { schema_version: 1, move: 'request_call', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Te llamamos para orientarte.'] },
      proposed_action: { type: 'request_call_now', reason: 'accepted_offer' },
    }),
  });
  expect(result).toMatchObject({ ok: true, action: { type: 'request_call_now', reason: 'direct_request' },
    transition: { call_preference: 'call', call_offer_count: 0, stage: 'handoff' } });
});

it('allows citing a workspace plan while preserving the absence of a purchase selection', () => {
  const plan: CanonicalFactV1 = { id: 'payment-workspace:monthly_12:label:v1', kind: 'payment_plan_label',
    source: 'business_snapshot', value: '12 pagos mensuales de USD 30', payment_plan: 'monthly_12' };
  const result = authorizeAgentTurnV2({ state: state(), offerings, facts: [...facts, plan],
    call_policy: { may_offer_call: false, may_request_call_now: false },
    proposal: proposal({ used_fact_ids: [plan.id],
      move: { schema_version: 1, move: 'ask_payment_options', secondary_moves: [], vetoes: [], confidence: 1 },
      response: { messages: ['Entre las opciones tenemos 12 pagos mensuales de USD 30.'] } }),
  });
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.transition.selected_offering_code).toBeNull();
  expect(result.transition.selected_payment_plan).toBeNull();
});

it('keeps an exact discussed course as commercial interest without selecting it for purchase', () => {
  const result = authorize({
    customerText: 'Estoy mirando el curso de redes, pero todavía no elegí',
    state: state(),
    proposal: proposal({
      move: {
        schema_version: 1,
        move: 'ask_course_information',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'redes',
        confidence: 1,
      },
      response: { messages: ['Redes Informáticas puede servirte para aprender una base práctica.'] },
      course_mentions:[{offering_code:'redes_informaticas',role:'alternative'}],
    }),
  });

  expect(result).toMatchObject({
    ok: true,
    discussed_offering_code: 'redes_informaticas',
    transition: { selected_offering_code: null },
  });
});

it('accepts the offered package without replacing its paid course with the mentioned bonus', () => {
  const result = authorize({
    customerText: 'Sí, está excelente; va también Excel',
    actionRejections: 'structured',
    courseBonus: {
      status: 'offer_available',
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: true,
      may_send_promoted_payment: false,
      promotion_code: 'redes_con_excel',
      interest_offering_code: 'redes_informaticas',
      bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
    },
    proposal: proposal({
      move: {
        schema_version: 1,
        move: 'select_payment_plan',
        secondary_moves: ['select_course'],
        vetoes: [],
        course_reference: 'excel',
        payment_plan: 'one_time',
        confidence: 1,
      },
      response: { messages: ['Perfecto, queda Redes con Excel incluido y pago único.'] },
      proposed_action: { type: 'accept_promotion' },
    }),
  });

  expect(result).toMatchObject({
    ok: true,
    action: { type: 'accept_promotion' },
    discussed_offering_code: 'redes_informaticas',
    transition: {
      selected_offering_code: 'redes_informaticas',
      selected_payment_plan: 'one_time',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
    },
  });
});

it('restores the paid course when the package is accepted without selecting a plan', () => {
  const result = authorize({
    customerText: 'Claro, va también Excel',
    state: state({
      selected_offering_code: 'excel_integral',
      selected_payment_plan: 'one_time',
      stage: 'plan_selected',
      awaiting_reply: 'payment_confirmation',
      payment_link_request: {
        status: 'pending',
        offering_code: 'excel_integral',
        payment_plan: 'one_time',
        requested_by_turn_id: null,
        resolved_by_decision_id: null,
      },
    }),
    courseBonus: {
      status: 'offer_available',
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: true,
      may_send_promoted_payment: false,
      promotion_code: 'redes_con_excel',
      interest_offering_code: 'redes_informaticas',
      bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
    },
    proposal: proposal({
      move: {
        schema_version: 1,
        move: 'unknown',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'excel',
        confidence: 1,
      },
      response: { messages: ['Perfecto, queda Redes con Excel incluido.'] },
      proposed_action: { type: 'accept_promotion' },
    }),
  });

  expect(result).toMatchObject({
    ok: true,
    action: { type: 'accept_promotion' },
    discussed_offering_code: 'redes_informaticas',
    transition: {
      selected_offering_code: 'redes_informaticas',
      selected_payment_plan: null,
      stage: 'course_selected',
      awaiting_reply: 'none',
      payment_link_request: { status: 'withdrawn' },
    },
  });
});

it.each([
  [
    'review',
    {
      status: 'review_available' as const,
      may_schedule_checkin: false,
      may_request_review: true,
      may_accept_offer: false,
      may_send_promoted_payment: false,
      promotion_code: null,
      interest_offering_code: 'redes_informaticas',
      bonus_offerings: [],
    },
    { type: 'request_promotion_review' as const, reason: 'persistent_price_objection' as const },
  ],
  [
    'acceptance',
    {
      status: 'offer_available' as const,
      may_schedule_checkin: false,
      may_request_review: false,
      may_accept_offer: true,
      may_send_promoted_payment: false,
      promotion_code: 'redes_con_excel',
      interest_offering_code: 'redes_informaticas',
      bonus_offerings: [{ code: 'excel_integral', display_name: 'Excel Integral', position: 1 }],
    },
    { type: 'accept_promotion' as const },
  ],
] as const)('keeps the reply and strips stale promotion %s when the discussed course changes', (
  _scenario,
  courseBonus,
  proposedAction,
) => {
  const result = authorize({
    customerText: 'En realidad quiero saber por Excel',
    actionRejections: 'structured',
    courseBonus,
    proposal: proposal({
      move: {
        schema_version: 1,
        move: 'ask_course_information',
        secondary_moves: [],
        vetoes: [],
        course_reference: 'excel',
        confidence: 1,
      },
      response: { messages: ['Claro, veamos Excel según lo que necesitas.'] },
      proposed_action: proposedAction,
    }),
  });

  expect(result).toMatchObject({
    ok: true,
    response: 'Claro, veamos Excel según lo que necesitas.',
    action: { type: 'none' },
    advisory_reasons: ['ACTION_NOT_AUTHORIZED'],
    discussed_offering_code: 'excel_integral',
    transition: { selected_offering_code: null },
  });
});

it('authorizes one different active catalog course for an any-course bonus review', () => {
  const courseBonus = {
    status: 'review_available' as const,
    may_schedule_checkin: false,
    may_request_review: true,
    may_accept_offer: false,
    may_send_promoted_payment: false,
    promotion_code: null,
    bonus_selection_mode: 'any_active_course' as const,
    interest_offering_code: 'redes_informaticas',
    bonus_offerings: [],
  };
  const dynamicProposal = (bonus_offering_code: string) => proposal({
    move: {
      schema_version: 1,
      move: 'ask_payment_options',
      secondary_moves: [],
      vetoes: [],
      course_reference: 'redes_informaticas',
      confidence: 1,
    },
    response: { messages: ['Dame un momento y reviso una alternativa para tu caso.'] },
    proposed_action: {
      type: 'request_promotion_review',
      reason: 'persistent_price_objection',
      bonus_offering_code,
    },
  });

  expect(authorize({ proposal: dynamicProposal('excel_integral'), courseBonus }))
    .toMatchObject({ ok: true, action: { type: 'request_promotion_review', bonus_offering_code: 'excel_integral' } });
  expect(authorize({ proposal: dynamicProposal('redes_informaticas'), courseBonus }))
    .toMatchObject({ ok: false, reasons: expect.arrayContaining(['ACTION_NOT_AUTHORIZED']) });
  expect(authorize({ proposal: dynamicProposal('curso_inexistente'), courseBonus }))
    .toMatchObject({ ok: false, reasons: expect.arrayContaining(['ACTION_NOT_AUTHORIZED']) });
});

it('keeps payment confirmation when a historically accepted call coexists with a new plan selection', () => {
  const result = authorize({ state: state({ selected_offering_code: 'redes_informaticas',
    call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'call_or_chat' }),
    intake: completeIntake, customerText: 'Elijo un pago.',
    proposal: proposal({ move: { schema_version: 1, move: 'select_payment_plan',
      secondary_moves: [], vetoes: [], confidence: 1, payment_plan: 'one_time' },
      response: { messages: ['Elegiste el pago único. ¿Confirmas tus datos para continuar?'] },
      used_fact_ids: ['payment:redes_informaticas:one_time:label:v1'] }) });
  expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: {
    selected_payment_plan: 'one_time', awaiting_reply: 'payment_confirmation',
    call_preference: 'call', call_offer_status: 'accepted' } });
});

it('does not rearm call availability from historical consent after an already completed handoff', () => {
  const result = authorize({ state: state({ selected_offering_code: 'redes_informaticas', stage: 'handoff',
    call_preference: 'call', call_offer_status: 'accepted', awaiting_reply: 'none' }),
    customerText: '¿Cuánto dura el curso?',
    proposal: proposal({ move: { schema_version: 1, move: 'ask_course_information',
      secondary_moves: [], vetoes: [], confidence: 1 }, response: { messages: ['Son 16 clases.'] },
      used_fact_ids: ['offering:redes_informaticas:duration:v1'] }) });
  expect(result).toMatchObject({ ok: true, action: { type: 'none' }, transition: { awaiting_reply: 'none' } });
});
