export function physicalOutboundTexts(input: {
  readonly final_response: string;
  readonly authored_messages: readonly string[] | null;
  readonly enabled: boolean;
}): string[] {
  return [input.final_response];
}
