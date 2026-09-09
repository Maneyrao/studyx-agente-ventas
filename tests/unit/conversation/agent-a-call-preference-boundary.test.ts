import {describe,expect,it} from 'vitest';
import {authorizeAgentTurnV2} from '@/features/conversation/domain/agent-turn-policy-v2';
import {createDefaultConversationStateV1} from '@/features/conversation/domain/conversation-planner';
import {validateAgentATurnProposalV1} from '../../../botpress-agent/src/lib/conversation/agent-a-brain';
import type {AgentAContextV1,AgentATurnProposalV1} from '../../../botpress-agent/src/schemas/agent-a-brain';

const identity={workspace_id:'11111111-1111-4111-8111-111111111111',conversation_id:'22222222-2222-4222-8222-222222222222',contact_id:'33333333-3333-4333-8333-333333333333'};
function setup(text:string,kind:AgentATurnProposalV1['move']['move']){
 const state={...createDefaultConversationStateV1(identity),selected_offering_code:'fotografia_profesional'};
 const proposal:AgentATurnProposalV1={schema_version:1,move:{schema_version:1,move:kind,secondary_moves:[],vetoes:[],confidence:1},response:{messages:['Te cuento cómo podemos seguir.'],call_offer:null},proposed_action:{type:'none'},used_fact_ids:[],used_memory_ids:[],memory_candidates:[],repair_of:null};
 const context:AgentAContextV1={schema_version:1,turn:{batch_messages:[{id:'m1',text}],recent_turns:[]},customer:{display_name:null,memories:[]},identity:null,commercial_state:{selected_offering_code:'fotografia_profesional',selected_payment_plan:null,stage:'course_selected',call_preference:'unknown',call_offer_status:'not_offered',call_offer_count:0,awaiting_reply:'none',payment_reported:false},catalog:{selected_offering:{code:'fotografia_profesional',display_name:'Fotografía Profesional',area_code:null,facts:[]},available_offerings:[],areas:[],candidate_offerings:[],payment_plans:[]},capabilities:{may_reply:true,may_offer_call:true,may_request_call_now:false,may_present_payment_options:true,may_send_payment_link:false,authorized_payment_plan:null,intake_status:'known',intake_missing:[]}};
 return {state,proposal,context,text};
}
function backend(x:ReturnType<typeof setup>){return authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:[x.text],call_policy:{may_offer_call:true,may_request_call_now:false}});}
function adk(x:ReturnType<typeof setup>){return validateAgentATurnProposalV1({proposal:x.proposal,context:x.context,planned_fact_ids:[],rejection_id:'44444444-4444-4444-8444-444444444444'});}

describe('call preference requires current customer evidence',()=>{
 it.each(['Quizás personal','Para mi trabajo','Me interesa como hobby'])('does not persist a chat refusal from a study purpose: %s',text=>{
  const x=setup(text,'continue_by_chat');
  expect(backend(x)).toMatchObject({ok:false,reasons:['CHANNEL_PREFERENCE_NOT_SUPPORTED']});
  expect(adk(x)?.rejections).toContainEqual({code:'CHANNEL_PREFERENCE_NOT_SUPPORTED',subject:'call_preference'});
 });
 it.each(['Prefiero seguir por chat','No quiero una llamada','Mejor seguimos por acá','Por escrito, por favor','Por chat, por favor','Contame por acá, por favor','No me llames'])('accepts an explicit preference: %s',text=>{
  const x=setup(text,'continue_by_chat');
  expect(backend(x)).toMatchObject({ok:true,transition:{call_preference:'chat',call_offer_status:'declined'}});
  expect(adk(x)).toBeNull();
 });
 it.each(['¿Por chat o por teléfono?', '¿Podemos seguir por chat o tiene que ser llamada?'])('does not treat a channel question as a choice: %s',text=>{
  const x=setup(text,'continue_by_chat');
  expect(backend(x)).toMatchObject({ok:false,reasons:['CHANNEL_PREFERENCE_NOT_SUPPORTED']});
  expect(adk(x)?.rejections).toContainEqual({code:'CHANNEL_PREFERENCE_NOT_SUPPORTED',subject:'call_preference'});
 });
 it('does not allow an unsupported call veto to suppress the first invitation',()=>{
  const x=setup('Contame sobre Fotografía Profesional','ask_course_information');
  x.proposal.move.vetoes=['call'];
  expect(backend(x).ok).toBe(false);
  expect(adk(x)?.rejections).toContainEqual({code:'CHANNEL_PREFERENCE_NOT_SUPPORTED',subject:'call_preference'});
 });
 it('rejects a fabricated call request that has no call action',()=>{
  const x=setup('Contame sobre Fotografía Profesional','request_call');
  expect(backend(x)).toMatchObject({ok:false});
  expect(adk(x)?.rejections).toContainEqual({code:'ACTION_NOT_AUTHORIZED',subject:'request_call_now'});
 });
 it('rejects offering a call in the same proposal that records chat preference',()=>{
  const x=setup('Prefiero seguir por chat','continue_by_chat');
  x.proposal.response.call_offer='Si querés, podemos coordinar una llamada.';
  expect(backend(x)).toMatchObject({ok:false});
  expect(adk(x)?.rejections).toContainEqual({code:'CHANNEL_PREFERENCE_NOT_SUPPORTED',subject:'call_offer'});
 });
 it('uses the latest message in a batch as the channel decision',()=>{
  const x=setup('mejor llamame','continue_by_chat');
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:['Prefiero chat','mejor llamame'],call_policy:{may_offer_call:true,may_request_call_now:false}}).ok).toBe(false);
  x.context.turn.batch_messages=[{id:'m1',text:'Prefiero chat'},{id:'m2',text:'mejor llamame'}];
  expect(adk(x)).not.toBeNull();
 });
 it('rejects a call action when the latest batched choice is chat',()=>{
  const x=setup('Prefiero chat','request_call');
  x.proposal.proposed_action={type:'request_call_now',reason:'direct_request'};
  x.context.capabilities.may_request_call_now=true;
  x.context.turn.batch_messages=[{id:'m1',text:'Llamame'},{id:'m2',text:'Prefiero chat'}];
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:['Llamame','Prefiero chat'],call_policy:{may_offer_call:true,may_request_call_now:true}})).toMatchObject({ok:false,reasons:['ACTION_NOT_AUTHORIZED']});
  expect(adk(x)?.rejections).toContainEqual({code:'ACTION_NOT_AUTHORIZED',subject:'request_call_now'});
 });
 it('accepts a call action when the latest batched choice is call',()=>{
  const x=setup('Llamame','request_call');
  x.proposal.proposed_action={type:'request_call_now',reason:'direct_request'};
  x.context.capabilities.may_request_call_now=true;
  x.context.turn.batch_messages=[{id:'m1',text:'Prefiero chat'},{id:'m2',text:'Llamame'}];
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:['Prefiero chat','Llamame'],call_policy:{may_offer_call:true,may_request_call_now:true}})).toMatchObject({ok:true,action:{type:'request_call_now'},transition:{call_preference:'call',stage:'handoff'}});
  expect(adk(x)).toBeNull();
 });
 it('never authorizes a call action against an explicit call refusal',()=>{
  const x=setup('No quiero una llamada','request_call');
  x.proposal.proposed_action={type:'request_call_now',reason:'direct_request'};
  x.context.capabilities.may_request_call_now=true;
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:['No quiero una llamada'],call_policy:{may_offer_call:true,may_request_call_now:true}})).toMatchObject({ok:false,reasons:['ACTION_NOT_AUTHORIZED']});
  expect(adk(x)?.rejections).toContainEqual({code:'ACTION_NOT_AUTHORIZED',subject:'request_call_now'});
 });
 it.each(['¿Hablamos por teléfono?','¿Podemos hablar por teléfono?'])('authorizes a direct natural call request: %s',text=>{
  const x=setup(text,'request_call');
  x.proposal.proposed_action={type:'request_call_now',reason:'direct_request'};
  x.context.capabilities.may_request_call_now=true;
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:[text],call_policy:{may_offer_call:true,may_request_call_now:true}})).toMatchObject({ok:true,action:{type:'request_call_now'},transition:{call_preference:'call',stage:'handoff'}});
  expect(adk(x)).toBeNull();
 });
 it('keeps a valid preference when a later batch message only adds a question',()=>{
  const x=setup('y contame el precio','continue_by_chat');
  expect(authorizeAgentTurnV2({proposal:x.proposal,state:x.state,offerings:[{code:'fotografia_profesional',display_name:'Fotografía Profesional'}],facts:[],current_customer_messages:['Prefiero chat','y contame el precio'],call_policy:{may_offer_call:true,may_request_call_now:false}}).ok).toBe(true);
 });
 it('uses the last decisive choice inside one message',()=>{
  const x=setup('Prefiero chat, aunque mejor llamame','continue_by_chat');
  expect(backend(x).ok).toBe(false);expect(adk(x)).not.toBeNull();
 });
 it('accepts a short refusal only in response to a pending call offer',()=>{
  const x=setup('No gracias','decline_call');
  expect(backend(x).ok).toBe(false);expect(adk(x)).not.toBeNull();
  x.state.awaiting_reply='call_or_chat';x.context.commercial_state.awaiting_reply='call_or_chat';
  expect(backend(x).ok).toBe(true);expect(adk(x)).toBeNull();
 });
 it('requires the first call offer when a known course is requested',()=>{
  const x=setup('Contame sobre Fotografía Profesional','ask_course_information');
  expect(backend(x)).toMatchObject({ok:false,reasons:['CALL_OFFER_REQUIRED']});
  expect(adk(x)?.rejections).toContainEqual({code:'CALL_OFFER_REQUIRED',subject:'call_offer'});
 });
 it('rejects an offer whose call sentence would be removed before delivery',()=>{
  const x=setup('Contame sobre Fotografía Profesional','ask_course_information');
  x.proposal.response.call_offer='Tu inscripción quedó confirmada y podemos coordinar una llamada.';
  expect(backend(x).ok).toBe(false);
  expect(adk(x)?.rejections).toContainEqual({code:'UNSUPPORTED_OPERATIONAL_CLAIM',subject:'call_offer'});
 });
 it('accepts a genuine first call offer',()=>{
  const x=setup('Contame sobre Fotografía Profesional','ask_course_information');
  x.proposal.response.call_offer='Si te sirve, podemos hablar por teléfono para orientarte.';
  expect(backend(x)).toMatchObject({ok:true,transition:{call_offer_count:1,call_offer_status:'offered'}});
  expect(adk(x)).toBeNull();
 });
 it('does not demand another invitation after a real chat choice',()=>{
  const x=setup('Contame más del curso','ask_course_information');
  x.state.call_preference='chat';x.state.call_offer_status='declined';
  x.context.commercial_state.call_preference='chat';x.context.commercial_state.call_offer_status='declined';x.context.capabilities.may_offer_call=false;
  expect(backend(x)).toMatchObject({ok:true});expect(adk(x)).toBeNull();
 });
});
