export function physicalOutboundTexts(input: {
  readonly final_response: string;
  readonly authored_messages: readonly string[] | null;
  readonly enabled: boolean;
}): string[] {
  if (!input.enabled || !input.authored_messages?.length) return [input.final_response];

  const authored = input.authored_messages.map((message) => message.trim()).filter(Boolean);
  if (authored.length === 0) return [input.final_response];

  const joined = authored.join('\n\n');
  if (input.final_response === joined) return fitIntoTransport(authored);

  const prefix = `${joined}\n\n`;
  if (!input.final_response.startsWith(prefix)) return [input.final_response];

  const suffix = input.final_response.slice(prefix.length).trim();
  return suffix ? fitIntoTransport([...authored, suffix]) : fitIntoTransport(authored);
}

/** Preserve every authored word while keeping the channel's three-part cap. */
function fitIntoTransport(parts: readonly string[]): string[] {
  if (parts.length <= 3) return [...parts];
  return [parts[0]!, parts.slice(1, -1).join('\n\n'), parts.at(-1)!];
}
