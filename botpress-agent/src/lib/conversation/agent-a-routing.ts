export function isLegacyConversationPipelineEligibleV1(input: {
  readonly conversationalBaseEligible: boolean
  readonly conversationPipelineEnabled: boolean
  readonly singleRoute: boolean
}): boolean {
  return input.conversationalBaseEligible
    && input.conversationPipelineEnabled
    && !input.singleRoute
}
