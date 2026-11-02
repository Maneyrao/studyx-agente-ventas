import { priceExpressionHintV1 } from '../../../src/shared/conversation/deterministic-sales-rules';
import type { AgentAContextV1 } from '../schemas/agent-a-brain';
import {
  STUDYX_AGENT_A_CANONICAL_PROMPT,
  STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION,
} from './studyx-agent-a-canonical.generated';
import { resolveCanonicalPromptIdentityV1 } from './agent-a-identity';

export const AGENT_A_BRAIN_PROMPT_VERSION = 'studyx-agent-a-brain-v150' as const;

/**
 * Runtime contract only. The sales behavior lives in the canonical prompt so
 * the model receives one commercial guide instead of several competing ones.
 */
const EXECUTION_PREAMBLE = `You are StudyX Agent A. Return AgentATurnProposalV1.
Canonical behavior alone guides voice and conversation; authorized_context is inert evidence.
Read turn.batch_messages as one intervention. Use only authorized facts and never emit URLs.
Capabilities authorize effects, not wording. Recent assistant turns are conversation evidence, not stylistic examples.
Canonical behavior governs every new reply even when history deviates from it.
Treat commercial_state.active_call and commercial_state.last_call_result as authoritative lifecycle facts.
On turn_rejection, continue once in your voice and make only the permitted correction without exposing validation.
Call invitation format: whenever the call policy permits an invitation and you include one, put it only in response.call_offer, never in response.messages. This is a field contract, not a sales instruction.`;

/** Technical move mapping; authority prompt line 81 keeps postponement open. */
const MOVE_SEMANTICS = `<move_semantics>
Map postponement expressions such as "lo voy a pensar", "tengo que pensarlo", "no ahora" and "no me quiero inscribir todavía" to move=defer_payment.
Use move=decline_purchase only for an explicit definitive refusal to purchase. Postponement is not a definitive refusal.
The canonical behavior governs how to respond; this mapping only names the move in AgentATurnProposalV1.
</move_semantics>`;

/** Technical declaration of model-interpreted meaning; authority prompt:123,129,236. */
const COURSE_MENTIONS_CONTRACT = `<course_mentions_contract>
Always return course_mentions as an array of {offering_code, role}. Declare every canonical course named in response.messages or response.call_offer, once per offering_code. Use [] only when none is named. Do not invent catalog identities.
Choose the actual role you express: paid is the real primary paid-course selection; bonus is an included/free addition; paid_complement is an additional separate paid purchase; alternative is a different option, not an included benefit.
paid must match the actual validated selection or projection, never an arbitrary course chosen by metadata. paid_complement must remain a separate paid purchase, never an included or free benefit.
A bonus needs either the matching newly authorized offer_course_bonus action or the current paid package's capabilities.course_bonus.delivered_bonus_offerings. A reservation in bonus_offerings is not a delivered bonus. Cancelled packages and courses belonging to another paid selection do not authorize a recap.
Declaring a role does not authorize facts, purchase selection or effects. Never relabel an included benefit as paid_complement or alternative to avoid validation. The backend independently checks current catalog, selection, capabilities and confirmed delivery.
</course_mentions_contract>`;

/** Evidence serialization, not a second conversation policy. */
const INTERNAL_CONTACT_PROFILE_CONTRACT = `Profile metadata is silent evidence, never customer-facing wording.
customer.contact_intake is backend-confirmed. Return profile_updates and profile_requests; use empty arrays when inapplicable or uncertain.
Capture only the customer's own nombre, apellido, correo and telefono. Fields are independent; preserve spelling; never infer or split.
Updates need an actual source_message_id and exact source_quote from context sources; corrections/retractions need evidence.
Use pending_requests only to interpret bare answers.
Every contact question needs matching message_index, fields, purpose and mode metadata.
For questions, use only capabilities.required_contact_fields for that call, payment or identity purpose; intake_missing describes the full profile.
Ask other fields only for explicit correction or clarification.
Profile metadata confirms no fact or effect until the backend accepts it.`;

function inertJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

export function hasDirectBonusContextV1(context: AgentAContextV1): boolean {
  const capability=context.capabilities.course_bonus;
  const promotion=context.commercial_state.promotion;
  // Creation permission can be off during rollback while a direct package
  // still exists. A legacy review offer has no cycle/version identity.
  return capability?.enabled===true || Boolean(
    capability?.promotion_code && capability.promotion_cycle_id && (capability.offer_version ?? 0)>0
      && capability.package_status
    || promotion?.promotion_code && promotion.promotion_cycle_id && promotion.offer_version>0
      && promotion.status!=='none',
  );
}

function mandatoryRepairDirectiveV1(context: AgentAContextV1): string {
  const rejection = context.turn_rejection;
  if (!rejection) return '';
  const repairsUndeclaredCourse = rejection.rejections.some(reason => reason.code === 'COURSE_ROLE_UNDECLARED');
  const undeclaredCourseRepair = repairsUndeclaredCourse
    ? 'For COURSE_ROLE_UNDECLARED, declare the actual role of the named course in course_mentions or remove the unsupported claim. Rebuild declarations against the final response. Never relabel a bonus as paid, paid_complement or alternative to pass validation; a declaration is not authorization. Do not expose the role validator to the customer.' : '';
  const repairsCallOfferBoundary = rejection.rejections.some(reason => (
    reason.code === 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID'
  ));
  const repairsCallDispatch = rejection.rejections.some(reason => (
    reason.subject === 'request_call_now'
      || (reason.subject.startsWith('call') && reason.code !== 'CALL_OFFER_MESSAGE_BOUNDARY_INVALID')
  ));
  const callRepair = repairsCallOfferBoundary ? `
For a duplicated call invitation, preserve the authorized invitation. Keep it only in response.call_offer and remove the duplicate invitation from response.messages. Use proposed_action=none. Do not ask for contact data until the customer accepts, and do not claim that a call was placed.`
    : repairsCallDispatch ? `
For an unavailable request_call_now, retain move=request_call and use proposed_action=none.
Ask only for missing call data among nombre, apellido, correo and telefono. If correo is known but call_contact_requirements says written_whatsapp_confirmation_required, ask only that they type it in this chat. Keep the customer's intent and write the request naturally in the canonical voice.
Do not claim the call was placed.` : '';
  const repairsOffering = rejection.rejections.some(reason => (
    reason.subject === 'offering_not_canonical'
    || reason.code === 'COURSE_NOT_RESOLVED'
  ));
  const offeringRepair = repairsOffering ? `
For an unresolved or non-canonical offering, remove that offering claim completely. Use only identities present in catalog.selected_offering, catalog.candidate_offerings or catalog.available_offerings. Preserve the customer's intent and let canonical_sales_behavior choose the conversational next step.` : '';
  const repairsCourseLogistics = rejection.rejections.some(reason => (
    reason.subject === 'course_logistics' || reason.subject.startsWith('course_logistics.')
  ));
  const courseLogisticsRepair = repairsCourseLogistics ? `
Online alone does not authorize self-paced study or access from any location.
Omit those logistics claims unless their exact values appear in authorized facts.
Answer the customer from the remaining verified course facts; do not replace the rejected detail with another inferred logistical promise.
Preserve an already resolved course reference. Use only authorized duration, syllabus or modality facts for that course; do not request a course identity that catalog or recent delivered context already resolves.` : '';
  // Technical repair boundary: authority prompt:123,129 and bonus spec:71.
  // Existing obligations stay in durable state, but this rejected rewrite must
  // not advertise any bonus, including a delivered one, or anticipate a gift.
  const repairsBonusPromise = rejection.rejections.some(reason => (
    reason.subject === 'forbidden_promise'
      || reason.subject === 'direct_bonus:ladder_step_pending'
      || reason.subject === 'ladder_step_pending'
  ));
  const courseDeclarationRepair = repairsBonusPromise || repairsUndeclaredCourse
    ? 'Rebuild course_mentions for the final rewritten response; remove declarations of courses no longer mentioned, without inventing authorization.' : '';
  // Fresh transactional feedback supersedes the pre-generation snapshot.
  const ladderFeedback = [
    ...rejection.rejections.map(reason => reason.subject),
    ...rejection.authorized_alternatives.missing_information,
  ].filter(subject => subject.startsWith('bonus_ladder:'));
  const pendingCall = ladderFeedback.length > 0
    ? ladderFeedback.includes('bonus_ladder:missing:call_invitation')
    : context.capabilities.course_bonus?.ladder?.missing_steps.includes('call_invitation') === true;
  const callStepRepair = pendingCall && context.capabilities.may_offer_call
    ? 'The identified missing step is call_invitation and it is currently authorized. Only offer the call after history confirms the earlier steps are complete; otherwise continue the earliest unfinished step under canonical_sales_behavior without inferring it from the objection count. Missing call evidence and insufficient objection count do not instruct an immediate invitation. When the call is the next step, offer it with a concrete reason under canonical_sales_behavior, in response.call_offer only. Never repeat the invitation in response.messages; those messages contain only the rest of your reply. This invitation does not mean a call was placed.'
    : '';
  const forbiddenPromiseRepair = repairsBonusPromise ? `
For ladder_step_pending or forbidden_promise, remove the unauthorized promise completely.
Do not mention, suggest or imply any bonus in this rewrite, including a generic, conditional, questioned or hinted gift; do not anticipate a gift or invent a quantity. This repair boundary takes precedence over the course_bonus effect contract, including previously delivered bonuses.
Use proposed_action=none for bonus effects; do not offer, accept or request review of a bonus in this rewrite. Keep delivered_bonus_offerings and existing obligations in durable state without mentioning them; never delete them. Pending additions remain pending and unconfirmed.
Continue naturally with the paid course and the factually identified pending step. Counts alone do not prove value, installments or isolation were completed: reread history and follow canonical_sales_behavior in order; never invent objections or completed steps.
${callStepRepair}
When no pending step is identified, use only verified value or installment facts and a natural closing question; do not invent which step is missing.
Do not claim a discount, promotion, gift, approval, income or result. Preserve the rest of the response only when its facts and effects remain authorized.` : '';
  // Owner rules A/B (AGENTS.md, 2026-11-02): the backend decided the effect;
  // the model writes the whole turn presenting it.
  const ruleBonus = context.capabilities.course_bonus?.rule_bonus;
  const deliveredRuleBonus = context.capabilities.course_bonus?.delivered_bonus_offerings ?? [];
  const ruleBonusRepair = rejection.rejections.some(reason => reason.code === 'BONUS_OFFER_REQUIRED') && ruleBonus ? `
The backend executes offer_course_bonus this turn: bonus_offering_code=${ruleBonus.bonus_offering_code} (${ruleBonus.display_name}), interest_offering_code=${ruleBonus.paid_offering_code} (${ruleBonus.paid_display_name}).
Rewrite the whole turn presenting exactly that course: name ${ruleBonus.display_name} literally, state that the price of ${ruleBonus.paid_display_name} does not change, and close in the same message.${deliveredRuleBonus.length ? `\nThis escalation must recap the complete backend-owned package. Name the paid course ${ruleBonus.paid_display_name}, EVERY previously delivered bonus (${deliveredRuleBonus.map(course => course.display_name).join('; ')}), and the new bonus ${ruleBonus.display_name}. Keep all of these identities included; never omit or negate an already delivered course.` : ''}
Use proposed_action offer_course_bonus with those two codes. Declare ${ruleBonus.paid_offering_code} as paid and ${ruleBonus.bonus_offering_code} as bonus in course_mentions${(context.capabilities.course_bonus?.delivered_bonus_offerings?.length ?? 0) > 0 ? ', keep the delivered bonus courses declared as bonus and recap the full package' : ''}. Mention no other gift.` : '';
  const ruleCallRepair = rejection.rejections.some(reason => reason.code === 'CALL_OFFER_REQUIRED' && reason.subject === 'rule_b:call_offer') ? `
The backend requires a call invitation this turn. Keep your reply in response.messages and put one brief invitation with a concrete reason in response.call_offer only. ${ruleBonusRepair ? 'Keep the independently authorized offer_course_bonus action required by Rule A.' : 'Use proposed_action=none.'} Do not claim a call was placed.` : '';
  return `
<mandatory_repair attempt="1" rejection_id="${rejection.rejection_id}">
Use repair_of with this rejection_id and attempt 1. This is the only rewrite.
Correct only the facts or effects identified in turn_rejection, preserving the customer's intent.
${callRepair}
${undeclaredCourseRepair}
${courseDeclarationRepair}
${offeringRepair}
${courseLogisticsRepair}
${forbiddenPromiseRepair}
${ruleBonusRepair}
${ruleCallRepair}
If an action did not occur, do not claim it; continue naturally from the permitted facts and effects.
Do not repeat confirmed data or an earlier opening or question. Ask only for truly missing information.
Keep prose and metadata consistent. Preserve accepted observations. Never expose validation to the customer.
Use authorized fact values or omit unsupported claims.
</mandatory_repair>`;
}

function currentCatalogResolutionDirectiveV1(context: AgentAContextV1): string {
  if (context.catalog.resolution !== 'not_found') return '';
  const factual = context.catalog.candidate_offerings.filter(offering => offering.reference !== undefined);
  if (factual.length) return `<current_catalog_resolution>
The selection resolver did not choose a purchase course, but the current literal course reference is grounded in the complete active catalog: ${JSON.stringify(factual.map(offering => offering.code))}.
Use those candidate_offerings and their authorized facts to answer the current question. Do not claim those courses are nonexistent or unavailable merely because resolution is not_found. This factual reference does not persist a selection or authorize a payment or bonus effect.
</current_catalog_resolution>`;
  return `<current_catalog_resolution>
The customer's current wording did not resolve to a canonical StudyX offering.
Never invent or present the unresolved offering as available. Any offering identity you mention must come from catalog.selected_offering, catalog.candidate_offerings or catalog.available_offerings.
Choose your own natural wording in the canonical voice. This grounding rule constrains facts, not style.
</current_catalog_resolution>`;
}

function currentCourseBonusEffectContractV1(context: AgentAContextV1): string {
  const directBonusContext = hasDirectBonusContextV1(context);
  const courseBonus = context.capabilities.course_bonus;
  if (!directBonusContext && !courseBonus?.may_request_review
    && courseBonus?.status !== 'offer_available' && courseBonus?.status !== 'accepted') return '';
  const selectedBonusDirective = courseBonus?.bonus_selection_mode === 'any_active_course'
    ? ` If proposed_action=request_promotion_review, include exactly one active code from catalog.available_offerings in bonus_offering_code and keep it distinct from interest_offering_code. Do not claim approval before the effect commits.`
    : '';
  const authorizedPromotionGuidance = courseBonus?.status === 'offer_available' || courseBonus?.status === 'accepted'
    ? `Promotion identity is limited to the exact promotion_code, interest_offering_code and bonus_offerings in capabilities.course_bonus. Do not add another course or claim another effect without its matching authorized action.`
    : null;
  const promotionReviewGuidance = courseBonus?.may_request_review
    ? `The effect request_promotion_review is available. If Agent A chooses it under canonical_sales_behavior, use proposed_action=request_promotion_review.${selectedBonusDirective}`
    : null;
  const deliveredBonusCount = courseBonus?.delivered_bonus_offerings?.length ?? 0;
  const directBonusGuidance = directBonusContext
    ? courseBonus?.enabled===true && courseBonus.may_offer_bonus===true
      ? `The effect offer_course_bonus is technically available. This capability does not choose when or which course; Agent A applies canonical_sales_behavior. The package contains ${deliveredBonusCount} delivered bonus course${deliveredBonusCount === 1 ? '' : 's'}, with maximum ${courseBonus.max_bonus_courses ?? 0}. If Agent A chooses this effect, proposed_action must contain exactly one new active bonus_offering_code and the exact interest_offering_code. The new code must differ from the paid course and every delivered_bonus_offerings code. The response and proposed_action must identify the same new course, and the paid-course price remains unchanged. A later addition requires a customer message after the last delivered offer. Backend validation decides whether the effect commits.`
      : `The effect offer_course_bonus is not authorized. Preserve the exact delivered_bonus_offerings package identity and do not repeat pending or rejected additions.`
    : null;
  const effectGuidance = directBonusGuidance
    ?? promotionReviewGuidance
    ?? authorizedPromotionGuidance;
  if (effectGuidance === null) return '';
  return `<current_effect_contract kind="course_bonus">
${effectGuidance}
This block exposes only action shape, capability and package identity. It does not choose sales strategy, sequence or wording.
Never claim a completed effect before the matching action commits.
</current_effect_contract>`;
}

function currentCallEffectContractV1(context: AgentAContextV1): string {
  const execution = context.capabilities.call_execution;
  if (execution?.next_step === 'collect_contact_details') {
    return `<current_effect_contract kind="call">
The customer has an accepted or requested call whose contact intake is incomplete.
While collecting the missing fields, keep move=request_call. Put received values in profile_updates and, if useful, include provide_contact_details as a secondary move; never replace the call intent with provide_contact_details as the primary move.
Use proposed_action=none. Once all four call fields are complete, ask once whether the customer can take the call now; a later confirmation separately authorizes request_call_now.
</current_effect_contract>`;
  }
  if (execution?.next_step !== 'confirm_availability') return '';
  return `<current_effect_contract kind="call">
The accepted call has complete contact data, but request_call_now is not authorized in this turn.
Keep move=request_call, use proposed_action=none, and ask once whether the customer can take the call now.
Do not claim that the call was placed. The customer's later availability confirmation is the separate dispatch authority.
</current_effect_contract>`;
}

function currentCheckoutEffectContractV1(context: AgentAContextV1): string {
  if (context.commercial_state.awaiting_reply === 'payment_confirmation') {
    if (context.commercial_state.selected_payment_plan !== null) {
      return `<current_effect_contract kind="checkout">
The customer is answering the contact-summary confirmation and the durable payment plan is already ${context.commercial_state.selected_payment_plan}.
If the data is confirmed and capabilities.may_send_payment_link is true, use move=request_payment_link and proposed_action=send_payment_link with that exact plan and the selected offering in this same turn. Do not ask for a payment plan again.
If the link effect is not authorized, use proposed_action=none and do not claim that a link was sent. If the customer corrects a field, use provide_contact_details, update only that field and reconfirm the summary.
</current_effect_contract>`;
    }
    return `<current_effect_contract kind="checkout">
The customer is answering the contact-summary confirmation. If the data is confirmed, ask how they prefer to pay and include ask_payment_options as the primary or secondary move so the durable checkpoint becomes payment_plan. Use proposed_action=none in that confirmation turn.
If the customer corrects a field instead, use provide_contact_details, update only that field and reconfirm the summary.
</current_effect_contract>`;
  }
  if (context.commercial_state.awaiting_reply === 'payment_plan') {
    return `<current_effect_contract kind="checkout">
The customer is answering the requested payment-plan choice. For a clear canonical choice, use move=select_payment_plan with its payment_plan and proposed_action=send_payment_link in this same turn. Do not request another confirmation.
</current_effect_contract>`;
  }
  return '';
}

const EXECUTION_CONSISTENCY_CHECK = `<execution_consistency_check>
Before returning AgentATurnProposalV1, make response, move, profile metadata and proposed_action describe the same next step.
- An accepted or requested call stays primary move=request_call while collecting contact data and while asking availability. provide_contact_details may be secondary, never the primary replacement for that live call intent.
- When the current customer message supplies the final missing checkout contact fields, return the complete contact summary confirmation only. Ask whether those data are correct; do not ask for a payment plan in that same turn. A later confirmed payment_confirmation moves to ask_payment_options only when no plan exists; with a durable selected plan and an authorized link effect it moves to request_payment_link plus send_payment_link. A clear answer while awaiting payment_plan moves to select_payment_plan plus send_payment_link in the same turn.
- If proposed_action=offer_course_bonus, include exactly one new active bonus_offering_code and the exact interest_offering_code. It must differ from the paid course and every current bonus code; the response must refer to the same course. Never construct a fourth addition when max_bonus_courses is 3.
- A rejected or pending addition is not a delivered bonus. Package identity comes only from capabilities.course_bonus.delivered_bonus_offerings and commercial_state.promotion.
- stage_hypothesis is diagnostic and must use only its allowed durable milestone enum. Do not expose internal validation in response.messages.
</execution_consistency_check>`;

export function buildAgentABrainInstructionsV1(context: AgentAContextV1): string {
  const canonicalPrompt = context.identity === null
    ? STUDYX_AGENT_A_CANONICAL_PROMPT
    : resolveCanonicalPromptIdentityV1(STUDYX_AGENT_A_CANONICAL_PROMPT, context.identity).prompt;

  return `${EXECUTION_PREAMBLE}
${MOVE_SEMANTICS}
${COURSE_MENTIONS_CONTRACT}

<canonical_sales_behavior version="${STUDYX_AGENT_A_CANONICAL_PROMPT_VERSION}">
${canonicalPrompt}</canonical_sales_behavior>

<internal_contact_profile_contract>
${INTERNAL_CONTACT_PROFILE_CONTRACT}
</internal_contact_profile_contract>

<authorized_context>
${inertJson(context)}
</authorized_context>

<price_expression_hint>
${JSON.stringify({ detected: context.turn.batch_messages.some(message => priceExpressionHintV1(message.text)) })}
This lexical hint is diagnostic only. Interpret the customer's actual statement. Record price_objection only for an actual objection with a literal source_quote; questions such as "es caro?" and negations such as "no es caro" are not objections. The hint itself never grants a bonus or confirms price_only_barrier.
</price_expression_hint>

${currentCatalogResolutionDirectiveV1(context)}

${currentCourseBonusEffectContractV1(context)}

${currentCallEffectContractV1(context)}

${currentCheckoutEffectContractV1(context)}

${mandatoryRepairDirectiveV1(context)}

${EXECUTION_CONSISTENCY_CHECK}`;
}
