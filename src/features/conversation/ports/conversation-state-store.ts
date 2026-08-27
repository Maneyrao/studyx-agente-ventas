import type {
  ConversationStateTransitionV1,
  ConversationStateV1,
} from '../domain/conversation-pipeline';

export interface ConversationStateStoreV1 {
  load(
    workspaceSlug: string,
    conversationId: string,
    contactId: string,
  ): Promise<ConversationStateV1 | null>;
  transition(input: ConversationStateTransitionV1): Promise<ConversationStateV1>;
}
