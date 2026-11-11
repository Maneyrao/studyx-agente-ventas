import type { ContactProfileRequestV1 } from '@/shared/conversation/contact-profile-contract';

/** Attach only to an exact authored paragraph that survived physical rendering. */
export function contactProfileRequestsForPartsV1(input: {
  readonly authored_messages: readonly string[];
  readonly part_texts: readonly string[];
  readonly requests: readonly {
    message_index: number; fields: ContactProfileRequestV1['fields'] | readonly ContactProfileRequestV1['fields'][number][];
    purpose: ContactProfileRequestV1['purpose']; mode: ContactProfileRequestV1['mode'];
  }[];
}): Array<Array<Omit<ContactProfileRequestV1, 'message_index'>>> {
  const result: Array<Array<Omit<ContactProfileRequestV1, 'message_index'>>> = input.part_texts.map(() => []);
  for (const request of input.requests) {
    // A split message carries its question in its last paragraph bubble.
    const original = splitAuthoredParagraphsV1(input.authored_messages[request.message_index] ?? '').at(-1);
    if (!original) continue;
    const matches = input.part_texts.flatMap((part, index) => {
      const at = part.indexOf(original);
      return at >= 0 && (at === 0 || part.slice(at - 2, at) === '\n\n')
        && (at + original.length === part.length || part.slice(at + original.length, at + original.length + 2) === '\n\n')
        ? [index] : [];
    });
    if (matches.length === 1) result[matches[0]!]!.push({
      fields: [...request.fields], purpose: request.purpose, mode: request.mode,
    });
  }
  return result;
}

export function physicalOutboundTexts(input: {
  readonly final_response: string;
  readonly authored_messages: readonly string[] | null;
  readonly enabled: boolean;
  /** Payment prose and its backend-authorized link belong to one customer message. */
  readonly force_single_message?: boolean;
}): string[] {
  if (input.force_single_message) return [input.final_response];
  if (!input.enabled || !input.authored_messages?.length) return [input.final_response];

  const authored = input.authored_messages.map((message) => message.trim()).filter(Boolean);
  if (authored.length === 0) return [input.final_response];

  const joined = authored.join('\n\n');
  const bubbles = authored.flatMap(splitAuthoredParagraphsV1);
  if (input.final_response === joined) return fitIntoTransport(bubbles);

  const prefix = `${joined}\n\n`;
  if (!input.final_response.startsWith(prefix)) return [input.final_response];

  const suffix = input.final_response.slice(prefix.length).trim();
  return suffix ? fitIntoTransport([...bubbles, suffix]) : fitIntoTransport(bubbles);
}

const LIST_LINE = /^(?:[-•*]|\d+[.)])\s/u;

/**
 * One authored message with a paragraph break reads as two WhatsApp bubbles
 * (owner 2026-11-11: long messages go out in two bubbles). A line break splits
 * only after a finished sentence and never inside a list.
 */
export function splitAuthoredParagraphsV1(message: string): string[] {
  const lines = message.split(/\n+/u).map((line) => line.trim()).filter(Boolean);
  const paragraphs: string[] = [];
  for (const line of lines) {
    const previous = paragraphs.at(-1);
    if (previous !== undefined && (!/[.!?…)]$/u.test(previous) || LIST_LINE.test(line))) {
      paragraphs[paragraphs.length - 1] = `${previous}\n${line}`;
    } else {
      paragraphs.push(line);
    }
  }
  return paragraphs;
}

/** Preserve every authored word while keeping the channel's three-part cap. */
function fitIntoTransport(parts: readonly string[]): string[] {
  if (parts.length <= 3) return [...parts];
  return [parts[0]!, parts.slice(1, -1).join('\n\n'), parts.at(-1)!];
}
