import { verifyAuthorizedEgress } from '@/features/orchestration/domain/egress-guard';
import type {
  OutboundAuthorizationDecision,
  OutboundContentAuthorizer,
} from '../ports/outbound-authorization';

/** Adapter that reuses the backend authority already applied to Agent A messages. */
export class AuthorizedEgressContentAuthorizer implements OutboundContentAuthorizer {
  verify(content: string, manifest: unknown): OutboundAuthorizationDecision {
    const result = verifyAuthorizedEgress({ content, manifest });
    if (result.ok) return { allowed: true, reason: null };
    return { allowed: false, reason: `EGRESS_${result.reason}` };
  }
}
