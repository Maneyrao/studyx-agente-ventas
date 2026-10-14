import type { ContactIntakeV1 } from '@/features/conversation/domain/conversation-planner';
import type { PostCallFollowupBriefV1 } from '../domain/post-call-followup';
import type { TerminalCallForFollowup } from './post-call-followup-store';

/** Durable, scoped data. Provider errors, transcripts and credentials are not part of this port. */
export interface PostCallNarrativeContext {
  /** Canonical workspace identity, shared with the regular chat context. */
  readonly academy_name: string;
  readonly customer: { readonly contact_intake: ContactIntakeV1 };
  readonly selected_course: { readonly code: string; readonly name: string } | null;
  readonly selected_payment_plan: string | null;
  readonly history: readonly { readonly direction: 'inbound' | 'outbound'; readonly text: string }[];
  readonly call_context: {
    readonly course_interest: string | null;
    readonly conversation_summary: string | null;
  };
  readonly analysis: {
    readonly summary: string | null;
    readonly pending_commitment: string | null;
    readonly principal_objection: string | null;
    readonly interest_level: string | null;
  } | null;
  readonly failure_code: string | null;
}

export interface ComposePostCallFollowupInput {
  readonly brief: PostCallFollowupBriefV1;
  readonly call: Pick<TerminalCallForFollowup,
    'call_id' | 'status' | 'result' | 'analysis_status' | 'disconnection_reason'>;
  readonly context: PostCallNarrativeContext;
}

/** Agent A authors the complete customer text; orchestration never supplies a fallback. */
export type ComposePostCallFollowup = (input: ComposePostCallFollowupInput) => Promise<string>;
