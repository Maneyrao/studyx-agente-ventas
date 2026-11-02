import type { AgentAContextV1, AgentATurnProposalV1 } from '../../schemas/agent-a-brain'
import { supportsCallRequestV1, supportsChatPreferenceV1 } from './channel-preference-evidence'

export type CustomerCallInterpretationV1 = AgentATurnProposalV1['move']
const CALL_CONTROLS = new Set(['request_call', 'decline_call', 'continue_by_chat'])

/** A prose/effect repair does not reinterpret the same customer's channel
 * choice. Keep only those controls/vetoes from the initial model reading;
 * course references, factual corrections and other classifications stay free.
 * Actual customer revocation remains an independent authoritative boundary. */
export function bindCustomerCallInterpretationV1(
  original: CustomerCallInterpretationV1,
  proposal: AgentATurnProposalV1,
  context: AgentAContextV1,
): AgentATurnProposalV1 {
  if (context.turn_rejection?.rejections.some(reason => reason.subject === 'call_consent_revoked')) return proposal
  const controls = new Set([original.move, ...original.secondary_moves].filter(move => CALL_CONTROLS.has(move)))
  const text = context.turn.batch_messages.map(message => message.text).join('\n')
  const pending = context.commercial_state.awaiting_reply === 'call_or_chat'
  const groundedRequest = supportsCallRequestV1(text, pending)
  const groundedChat = supportsChatPreferenceV1(text, pending)
  const allowed = new Set(controls)
  if (groundedRequest) allowed.add('request_call')
  if (groundedChat) allowed.add('continue_by_chat')
  const primary = CALL_CONTROLS.has(proposal.move.move) && !allowed.has(proposal.move.move)
    ? original.move : proposal.move.move
  const secondary = [...new Set([
    ...proposal.move.secondary_moves.filter(move => !CALL_CONTROLS.has(move)
      || (move === 'request_call' && groundedRequest) || (move === 'continue_by_chat' && groundedChat)),
    ...controls,
  ])].filter(move => move !== primary)
  const vetoes = [...proposal.move.vetoes.filter(veto => veto !== 'call'),
    ...(original.vetoes.includes('call') ? ['call' as const] : [])]
  if (primary === proposal.move.move && JSON.stringify(secondary) === JSON.stringify(proposal.move.secondary_moves)
    && JSON.stringify(vetoes) === JSON.stringify(proposal.move.vetoes)) return proposal
  return { ...proposal, move: { ...proposal.move, move: primary, secondary_moves: secondary, vetoes } }
}
