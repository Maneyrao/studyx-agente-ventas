import { describe, expect, it } from 'vitest';
import type { AgentATurnProposalV1 } from '@/features/conversation/domain/agent-a-brain';
import type { CanonicalFactV1, ConversationStateV1 } from '@/features/conversation/domain/conversation-pipeline';
import { createDefaultConversationStateV1 } from '@/features/conversation/domain/conversation-planner';
import { deriveCourseBonusLadderV1 } from '@/shared/conversation/bonus-ladder';
import { authorizeAgentTurnV2 } from '@/features/conversation/domain/agent-turn-policy-v2';
import { contactProfileRequestsForPartsV1 } from '@/features/orchestration/domain/physical-outbound-texts';

const identity = {
  workspace_id: '11111111-1111-4111-8111-111111111111',
  conversation_id: '22222222-2222-4222-8222-222222222222',
  contact_id: '33333333-3333-4333-8333-333333333333',
};

const offerings = [
  { code: 'redes_informaticas', display_name: 'Redes Informáticas', aliases: ['redes'] },
  { code: 'excel_integral', display_name: 'Excel Integral', aliases: ['excel'] },
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
  it.each(['payment_plan', 'payment_confirmation', 'contact_details'] as const)(
    'rejects a model-proposed bonus and proactive invitation during checkout even if both capabilities are permissive: %s', awaiting => {
      const cap = { enabled: true, max_bonus_courses: 3 as const, may_offer_bonus: true, status: 'checkin_available' as const,
        may_schedule_checkin: false, may_request_review: false, may_accept_offer: false, may_send_promoted_payment: false,
        promotion_code: null, interest_offering_code: 'redes_informaticas', bonus_offerings: [],
        bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }],
        ladder: deriveCourseBonusLadderV1({ price_evidence: true, retention_used: false }) };
      const current = state({ selected_offering_code: 'redes_informaticas', awaiting_reply: awaiting });
      const bonusResult = authorize({ state: current, courseBonus: cap, proposal: proposal({
        proposed_action: { type: 'offer_course_bonus', interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' },
        response: { messages: ['Te sumo Excel Integral.'] }, course_mentions: [{ offering_code: 'excel_integral', role: 'bonus' }] }) });
      expect(bonusResult).toMatchObject({ ok: false,
        rejection_subjects: ['forbidden_promise', 'direct_bonus:sale_already_closed'] });
      const callResult = authorize({ state: current, mayOfferCall: true, proposal: proposal({
        response: { messages: ['Te cuento las opciones.'], call_offer: 'Si querés, podemos verlo en una llamada corta. Te sirve?' } }) });
      expect(callResult).toMatchObject({ ok: false, reasons: expect.arrayContaining(['CALL_OFFER_NOT_AUTHORIZED']) });
    });

  it('uses the paid identity of a validated bonus effect without inventing a purchase selection',()=>{
    const result=authorize({state:state(),courseBonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:true,status:'checkin_available',
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:null,
      interest_offering_code:'redes_informaticas',bonus_offerings:[],bonus_candidates:[{code:'excel_integral',display_name:'Excel Integral'}],ladder:deriveCourseBonusLadderV1({price_evidence:true,retention_used:false})},
      proposal:proposal({response:{messages:['Redes Informáticas e Excel Integral pueden servirte.']},
        course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}],
        proposed_action:{type:'offer_course_bonus',interest_offering_code:'redes_informaticas',bonus_offering_code:'excel_integral'}})});
    expect(result).toMatchObject({ok:true,action:{type:'offer_course_bonus'},transition:{selected_offering_code:null}});
  });
  it.each(['offered','cancelled','expired'] as const)('uses only a delivered current package identity for a selectionless recap (%s)',status=>{
    const result=authorize({state:state(),courseBonus:{enabled:true,max_bonus_courses:3,may_offer_bonus:false,status:'offer_available',package_status:status,
      may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,promotion_code:'p',
      interest_offering_code:'redes_informaticas',bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}],
      delivered_bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]},
      proposal:proposal({response:{messages:['Redes Informáticas e Excel Integral pueden servirte.']},
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
  it('authorizes exactly one active direct course only with the capability', () => {
    const p = proposal({ proposed_action: { type: 'offer_course_bonus',
      interest_offering_code: 'redes_informaticas', bonus_offering_code: 'excel_integral' } });
    const cap: NonNullable<Parameters<typeof authorizeAgentTurnV2>[0]['course_bonus']> = { status: 'checkin_available', enabled: true, max_bonus_courses: 2,
      ladder: deriveCourseBonusLadderV1({ price_evidence: true, retention_used: false }),
      may_offer_bonus: true, may_schedule_checkin: false, may_request_review: false,
      may_accept_offer: false, may_send_promoted_payment: false, promotion_code: null,
      interest_offering_code: 'redes_informaticas', bonus_offerings: [],
      bonus_candidates: [{ code: 'excel_integral', display_name: 'Excel Integral' }] };
    expect(authorize({ proposal: p, state: state({selected_offering_code:'redes_informaticas'}),
      courseBonus: cap })).toMatchObject({ok:true, action:p.proposed_action});
    expect(authorize({ proposal:p, state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:{...cap,enabled:false}, actionRejections:'structured' }))
      .toMatchObject({ok:false, rejection_subjects:['forbidden_promise','direct_bonus:bonus_disabled']});
    // A course outside the authorized set (affinity row, bridges, named literally) is rejected.
    expect(authorize({ proposal:p, state:state({selected_offering_code:'redes_informaticas'}),
      courseBonus:{...cap,bonus_candidates:[{code:'camaras_seguridad',display_name:'Cámaras'}]} }))
      .toMatchObject({ok:false, rejection_subjects:['forbidden_promise','direct_bonus:invalid_offering']});
  });
  // Model-owned bonus (AGENTS.md "Venta interpretada por el modelo"): the model proposes, the backend validates.
  const ruleCap=(evidence:boolean,extra:Record<string,unknown>={})=>({status:'checkin_available' as const,enabled:true,max_bonus_courses:2 as const,may_offer_bonus:true,
    ladder:deriveCourseBonusLadderV1({price_evidence:evidence,retention_used:false}),
    may_schedule_checkin:false,may_request_review:false,may_accept_offer:false,may_send_promoted_payment:false,
    promotion_code:null,interest_offering_code:'redes_informaticas',bonus_offerings:[],
    bonus_candidates:[{code:'excel_integral',display_name:'Excel Integral'}],...extra});
  const bonusProposal=(memory:Array<{type:string;key:string;value:string;source_quote:string;confidence:number}>=[])=>proposal({
    response:{messages:['Te sumo Excel Integral sin costo; el precio de Redes Informáticas sigue igual. Avanzamos?']},
    course_mentions:[{offering_code:'redes_informaticas',role:'paid'},{offering_code:'excel_integral',role:'bonus'}],
    proposed_action:{type:'offer_course_bonus',interest_offering_code:'redes_informaticas',bonus_offering_code:'excel_integral'},
    memory_candidates:memory as never});
  const objection={type:'objection',key:'price_objection',value:'caro',source_quote:'me sigue pareciendo caro',confidence:1};
  const decline={type:'objection',key:'purchase_decline',value:'no',source_quote:'no gracias, lo dejo',confidence:1};
  const rejectedBy=(reason:string)=>({ok:false,rejection_subjects:expect.arrayContaining([`direct_bonus:${reason}`])});
  const selected=()=>state({selected_offering_code:'redes_informaticas'});
  it('no instant trigger: a promo request with no price evidence is pending, whatever the customer text says', () => {
    expect(authorize({state:selected(),customerText:'me hacés un descuento?',proposal:bonusProposal(),courseBonus:ruleCap(false)}))
      .toMatchObject(rejectedBy('ladder_step_pending'));
  });
  it('persisted price evidence (one objection, no count of two, no call prerequisite) authorizes a candidate', () => {
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),courseBonus:ruleCap(true)}))
      .toMatchObject({ok:true,action:{type:'offer_course_bonus'}});
  });
  it('this turn\'s objection memory with a literal quote is price evidence on the first objection', () => {
    expect(authorize({state:selected(),customerText:'me sigue pareciendo caro',
      proposal:bonusProposal([objection]),courseBonus:ruleCap(false)})).toMatchObject({ok:true,action:{type:'offer_course_bonus'}});
  });
  it('a quote that is not in the customer text, a question or a negation does not count', () => {
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal([objection]),courseBonus:ruleCap(false)})).toMatchObject({ok:false});
    expect(authorize({state:selected(),customerText:'es caro?',proposal:bonusProposal([{...objection,source_quote:'caro'}]),courseBonus:ruleCap(false)})).toMatchObject({ok:false});
  });
  it('a confirmed price-only barrier authorizes on the first objection', () => {
    expect(authorize({state:selected(),customerText:'si, solo el precio',
      proposal:bonusProposal([{type:'constraint',key:'price_only_barrier',value:'confirmed',source_quote:'solo el precio',confidence:1}]),
      courseBonus:ruleCap(false)})).toMatchObject({ok:true});
  });
  it('retention: a quoted purchase decline authorizes without price evidence, once per conversation', () => {
    expect(authorize({state:selected(),customerText:'no gracias, lo dejo',proposal:bonusProposal([decline]),courseBonus:ruleCap(false)}))
      .toMatchObject({ok:true,action:{type:'offer_course_bonus'}});
    const used=ruleCap(false,{ladder:deriveCourseBonusLadderV1({price_evidence:false,retention_used:true})});
    expect(authorize({state:selected(),customerText:'no gracias, lo dejo',proposal:bonusProposal([decline]),courseBonus:used}))
      .toMatchObject(rejectedBy('ladder_step_pending'));
    expect(authorize({state:selected(),customerText:'no gracias',proposal:bonusProposal([decline]),courseBonus:ruleCap(false)}))
      .toMatchObject(rejectedBy('ladder_step_pending'));
  });
  it('a used retention does not block a bonus backed by price evidence', () => {
    const used=ruleCap(true,{ladder:deriveCourseBonusLadderV1({price_evidence:true,retention_used:true})});
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),courseBonus:used})).toMatchObject({ok:true});
  });
  it('affinity is set membership: a candidate is accepted, anything else is not; the paid course is never a bonus', () => {
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),
      courseBonus:ruleCap(true,{bonus_candidates:[{code:'camaras_seguridad',display_name:'Cámaras'}]})})).toMatchObject(rejectedBy('invalid_offering'));
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),
      courseBonus:ruleCap(true,{bonus_candidates:[]})})).toMatchObject(rejectedBy('invalid_offering'));
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),courseBonus:ruleCap(true)})).toMatchObject({ok:true});
    const paid=proposal({proposed_action:{type:'offer_course_bonus',interest_offering_code:'redes_informaticas',bonus_offering_code:'redes_informaticas'}});
    expect(authorize({state:selected(),customerText:'ok',proposal:paid,courseBonus:ruleCap(true)})).toMatchObject(rejectedBy('same_as_paid_course'));
  });
  it('limits: max reached and repeated course', () => {
    const one={bonus_offerings:[{code:'camaras_seguridad',display_name:'Cámaras',position:1}],status:'offer_available',package_status:'offered',promotion_code:'p'};
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),
      courseBonus:ruleCap(true,{...one,max_bonus_courses:1}) as never})).toMatchObject(rejectedBy('bonus_limit_reached'));
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),
      courseBonus:ruleCap(true,{...one,bonus_offerings:[{code:'excel_integral',display_name:'Excel Integral',position:1}]}) as never}))
      .toMatchObject(rejectedBy('duplicate_bonus'));
  });
  it('escalation after a delivered offer uses the same permission: persisted evidence is enough, no new objection required', () => {
    const delivered={bonus_offerings:[{code:'camaras_seguridad',display_name:'Cámaras',position:1}],
      status:'offer_available',package_status:'offered',promotion_code:'p'};
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),courseBonus:ruleCap(true,delivered) as never}))
      .toMatchObject({ok:true,action:{type:'offer_course_bonus'}});
    expect(authorize({state:selected(),customerText:'ok',proposal:bonusProposal(),courseBonus:ruleCap(false,delivered) as never}))
      .toMatchObject(rejectedBy('ladder_step_pending'));
  });
  it('never in checkout (state only), even with price evidence or a quoted decline', () => {
    for (const awaiting of ['payment_plan','payment_confirmation','contact_details'] as const)
      expect(authorize({state:state({selected_offering_code:'redes_informaticas',awaiting_reply:awaiting}),customerText:'me sigue pareciendo caro',
        proposal:bonusProposal([objection]),courseBonus:ruleCap(true)})).toMatchObject(rejectedBy('sale_already_closed'));
  });
  it('a literal swap of the single bonus needs no price evidence', () => {
    const swap={ok:true,action:{type:'offer_course_bonus'}};
    const swapCap=ruleCap(false,{bonus_offerings:[{code:'camaras_seguridad',display_name:'Cámaras',position:1}],status:'offer_available',
      package_status:'offered',promotion_code:'p',bonus_candidates:[],
      rule_bonus:{paid_offering_code:'redes_informaticas',paid_display_name:'Redes Informáticas',bonus_offering_code:'excel_integral',
        display_name:'Excel Integral',position:1,source:'customer_request',replaces_offering_code:'camaras_seguridad',replaces_display_name:'Cámaras'}});
    expect(authorize({state:selected(),customerText:'cambiame cámaras por excel integral',
      proposal:bonusProposal(),courseBonus:swapCap as never})).toMatchObject(swap);
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
